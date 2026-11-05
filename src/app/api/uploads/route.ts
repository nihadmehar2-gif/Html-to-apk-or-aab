import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { rateLimit, clientIp, detectFileKind, checkZipEntryName } from '@/lib/security';
import { config, ensureStorageDirs } from '@/lib/config';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Analysis = {
  kind: 'HTML' | 'ZIP';
  fileCount: number;
  totalBytes: number;
  entryPath: string | null;
  entryCandidates: string[];
  htmlFiles: string[];
  externalHosts: string[];
  assetSummary: Record<string, number>;
  warnings: string[];
};

const EXTERNAL_RE = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']|url\(\s*["']?https?:\/\/[^)"']+\)|["']https?:\/\/[^"'\s)]+["']/gi;

function collectExternalHosts(text: string, hosts: Set<string>) {
  const matches = text.match(EXTERNAL_RE) || [];
  for (const m of matches) {
    const urlMatch = m.match(/https?:\/\/([^"'\s)/]+)/i);
    if (urlMatch) hosts.add(urlMatch[1].toLowerCase());
  }
}

function analyzeDirectory(rootDir: string, kind: 'HTML' | 'ZIP'): Analysis {
  const htmlFiles: string[] = [];
  const allFiles: { rel: string; size: number }[] = [];
  const hosts = new Set<string>();
  const assetSummary: Record<string, number> = {};
  let totalBytes = 0;

  const categorize = (rel: string): string => {
    const ext = path.extname(rel).toLowerCase();
    if (['.html', '.htm'].includes(ext)) return 'html';
    if (['.css'].includes(ext)) return 'css';
    if (['.js', '.mjs'].includes(ext)) return 'javascript';
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'].includes(ext)) return 'images';
    if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'fonts';
    if (['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext)) return 'media';
    if (['.json', '.geojson', '.map'].includes(ext)) return 'json';
    return 'other';
  };

  (function walk(dir: string, rel: string) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else {
        allFiles.push({ rel: r, size: st.size });
        totalBytes += st.size;
        const cat = categorize(r);
        assetSummary[cat] = (assetSummary[cat] || 0) + 1;
        if (cat === 'html') htmlFiles.push(r);
      }
    }
  })(rootDir, '');

  // scan text files for external references (limit per file to stay fast)
  for (const f of allFiles) {
    if (f.size > 2 * 1024 * 1024) continue;
    if (!/\.(html?|css|js|mjs|json)$/i.test(f.rel)) continue;
    try {
      const text = fs.readFileSync(path.join(rootDir, f.rel), 'utf8');
      collectExternalHosts(text, hosts);
    } catch { /* binary-ish file, skip */ }
  }

  // entry detection: index.html at shallowest depth, then any index.htm/html
  const indexish = htmlFiles
    .filter((h) => /(^|\/)index\.html?$/i.test(h))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  const entryPath = kind === 'HTML' ? htmlFiles[0] || null : (indexish[0] || null);
  const entryCandidates = indexish.slice(0, 10);

  const warnings: string[] = [];
  if (hosts.size > 0) {
    warnings.push(
      `This project references ${hosts.size} external host${hosts.size > 1 ? 's' : ''} (${[...hosts].slice(0, 5).join(', ')}${hosts.size > 5 ? '…' : ''}). Internet permission is recommended and network access will be required at runtime.`
    );
  }
  if (kind === 'ZIP' && !entryPath) {
    warnings.push('No index.html was found at the root or in any folder — you will need to select the entry HTML file.');
  }
  // single HTML: warn when it references local files that were NOT uploaded
  if (kind === 'HTML' && htmlFiles[0]) {
    const html = fs.readFileSync(path.join(rootDir, htmlFiles[0]), 'utf8');
    const relRefs = new Set<string>();
    const refRe = /(?:src|href)\s*=\s*["']([^"']*)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(html)) !== null) {
      const ref = m[1].trim();
      if (!ref || /^(https?:|data:|#|\/\/|mailto:|tel:|javascript:)/i.test(ref)) continue;
      const clean = ref.split('#')[0].split('?')[0];
      if (/\.[a-z0-9]{1,5}$/i.test(clean)) relRefs.add(clean);
    }
    const missing = [...relRefs].filter((r) => !fs.existsSync(path.join(rootDir, r)));
    if (missing.length > 0) {
      warnings.push(
        `${missing.length} local file${missing.length > 1 ? 's' : ''} referenced by this HTML ${missing.length > 1 ? 'were' : 'was'} not uploaded (e.g. ${missing.slice(0, 4).join(', ')}). A single HTML file cannot bundle its local assets — upload the complete website as a ZIP to include them.`
      );
    }
  }
  return {
    kind,
    fileCount: allFiles.length,
    totalBytes,
    entryPath,
    entryCandidates,
    htmlFiles: htmlFiles.slice(0, 60),
    externalHosts: [...hosts].slice(0, 20),
    assetSummary,
    warnings,
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    ensureStorageDirs();
    const rl = rateLimit(`upload:${user.id}:${clientIp(req)}`, config.rateLimits.upload.limit, config.rateLimits.upload.windowMs);
    if (!rl.ok) {
      return NextResponse.json({ error: `Upload limit reached (${config.rateLimits.upload.limit}/hour). Try again later.` }, { status: 429 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file received. Please attach a file.' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 });
    }
    if (file.size > config.maxUploadBytes) {
      return NextResponse.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${config.maxUploadBytes / 1024 / 1024} MB.` }, { status: 413 });
    }
    const filename = file.name || 'upload';
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = detectFileKind(filename, buf, file.type);
    if (!kind) {
      if (filename.toLowerCase().endsWith('.zip')) {
        return NextResponse.json({ error: 'Corrupted ZIP archive: this file does not have a valid ZIP structure (missing PK header). Re-export it and try again.' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Unsupported file. Upload an .html/.htm file or a .zip website project.' }, { status: 415 });
    }

    const uploadId = crypto.randomUUID();
    const dir = path.join(config.uploadsDir, uploadId);
    fs.mkdirSync(dir, { recursive: true });

    let analysis: Analysis;
    if (kind === 'ZIP') {
      // strict entry-name validation BEFORE writing anything to disk
      const AdmZip = (await import('adm-zip')).default;
      let zip: import('adm-zip');
      try { zip = new AdmZip(buf); } catch {
        return NextResponse.json({ error: 'Corrupted ZIP archive: the central directory could not be read.' }, { status: 400 });
      }
      const entries = zip.getEntries().filter((e) => !e.entryName.startsWith('__MACOSX/') && e.entryName.split('/').pop() !== '.DS_Store');
      if (entries.length > config.maxFiles) {
        return NextResponse.json({ error: `ZIP contains too many entries (${entries.length}); maximum is ${config.maxFiles}.` }, { status: 413 });
      }
      let totalUncompressed = 0;
      for (const entry of entries) {
        const rawName = entry.rawEntryName ? entry.rawEntryName.toString('utf8') : entry.entryName;
        const checkRaw = checkZipEntryName(rawName);
        if (!checkRaw.ok) {
          return NextResponse.json({ error: `Unsafe ZIP entry rejected — ${checkRaw.reason}` }, { status: 400 });
        }
        const check = checkZipEntryName(entry.entryName);
        if (!check.ok) {
          return NextResponse.json({ error: `Unsafe ZIP entry rejected — ${check.reason}` }, { status: 400 });
        }
        totalUncompressed += entry.header.size;
        if (totalUncompressed > config.maxExtractBytes) {
          return NextResponse.json({ error: 'ZIP decompressed size exceeds the platform limit (400 MB).' }, { status: 413 });
        }
      }
      // safe extraction into the upload directory
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const rawName = entry.rawEntryName ? entry.rawEntryName.toString('utf8') : entry.entryName;
        const rawCheck = checkZipEntryName(rawName);
        if (!rawCheck.ok) continue; // already rejected above; skip anything abnormal
        const normalized = checkZipEntryName(entry.entryName);
        if (!normalized.ok || !normalized.normalized) continue;
        const dest = path.join(dir, normalized.normalized);
        if (!path.resolve(dest).startsWith(path.resolve(dir))) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
      }
      // analyze the extracted tree BEFORE storing original.zip so that the
      // archive itself is never counted as a project asset
      analysis = analyzeDirectory(dir, 'ZIP');
      fs.writeFileSync(path.join(dir, 'original.zip'), buf);
    } else {
      // normalize the entry name to index.html so the packaged start page is canonical
      const entryName = 'index.html';
      fs.writeFileSync(path.join(dir, entryName), buf);
      fs.writeFileSync(path.join(dir, 'original.html'), buf);
      analysis = analyzeDirectory(dir, 'HTML');
      analysis.entryPath = entryName;
      analysis.fileCount = 1;
      analysis.totalBytes = buf.length;
      analysis.htmlFiles = [entryName];
      if (buf.length > config.maxHtmlBytes) {
        return NextResponse.json({ error: `HTML file too large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Maximum is ${config.maxHtmlBytes / 1024 / 1024} MB.` }, { status: 413 });
      }
      const head = buf.subarray(0, 4096).toString('utf8').toLowerCase();
      if (!head.includes('<')) {
        return NextResponse.json({ error: 'The uploaded file does not appear to contain valid HTML markup.' }, { status: 415 });
      }
    }

    // persist metadata
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ uploadId, userId: user.id, filename, kind, size: file.size, createdAt: new Date().toISOString() }));

    const project = await db.project.create({
      data: {
        userId: user.id,
        name: filename.replace(/\.(html?|zip)$/i, '').slice(0, 80) || 'Untitled project',
        sourceType: kind,
        originalName: filename,
        size: file.size,
        fileCount: analysis.fileCount,
        entryPath: analysis.entryPath || '',
        storagePath: dir,
      },
    });

    return NextResponse.json({ projectId: project.id, uploadId, filename, kind, analysis });
  } catch (e) {
    return errorResponse(e);
  }
}
