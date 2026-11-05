import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { appConfigSchema, resolveBuildTargets, targetsNeedReleaseKeystore } from '@/lib/app-config';
import { validatePackageName, validateVersionName, validateHexColor } from '@/lib/security';
import { config, ensureStorageDirs } from '@/lib/config';
import { janitor, pumpQueue } from '@/lib/build-queue';
import { errorResponse, zodMessage, publicBuild } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** GET the authenticated user's builds (with project info). */
export async function GET() {
  try {
    const user = await requireUser();
    await janitor();
    const builds = await db.build.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { project: { select: { id: true, name: true, sourceType: true, originalName: true } } },
    });
    return NextResponse.json({
      builds: builds.map((b) => ({ ...publicBuild(b), project: b.project })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const createSchema = z.object({
  projectId: z.string().min(1, 'Project is required — upload a file first.'),
  config: appConfigSchema,
});

/**
 * POST create a new build job.
 * Validates the full Android configuration, then queues the build.
 * The real Gradle build runs in an isolated detached worker process.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    ensureStorageDirs();
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const { projectId } = parsed.data;
    const cfg = parsed.data.config as Record<string, unknown>;

    // server-side re-validation of critical fields
    const pkgError = validatePackageName(String(cfg.packageName));
    if (pkgError) return NextResponse.json({ error: pkgError }, { status: 400 });
    const verError = validateVersionName(String(cfg.versionName));
    if (verError) return NextResponse.json({ error: verError }, { status: 400 });
    for (const key of ['themeColor', 'statusBarColor', 'navigationBarColor', 'splashColor']) {
      if (cfg[key] && validateHexColor(String(cfg[key]))) {
        return NextResponse.json({ error: `${key}: ${validateHexColor(String(cfg[key]))}` }, { status: 400 });
      }
    }
    if (cfg.buildType === 'RELEASE' && !cfg.releaseKeystoreId) {
      return NextResponse.json({ error: 'Release builds require a signing keystore. Generate one or upload yours in the Signing section.' }, { status: 400 });
    }
    // AAB is always release-signed (Google Play upload format), so any build
    // that produces an AAB (AAB-only or BOTH) needs a release keystore too.
    const buildTargets = resolveBuildTargets(cfg as { buildTargets?: string; generateAab?: boolean });
    if (targetsNeedReleaseKeystore(cfg as { buildTargets?: string; generateAab?: boolean; buildType?: string }) && !cfg.releaseKeystoreId) {
      return NextResponse.json({
        error: buildTargets === 'AAB'
          ? 'AAB builds must be signed with a release keystore (Google Play requirement). Generate one or upload yours in the Signing section.'
          : 'Builds that include an AAB require a signing keystore — the bundle is always release-signed. Configure signing and try again.',
      }, { status: 400 });
    }

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: 'Project not found. Upload your file first.' }, { status: 404 });
    }

    // resolve entry file (reject traversal / absolute paths up front)
    const rawEntry = String(cfg.entryPath || project.entryPath || 'index.html');
    if (path.isAbsolute(rawEntry) || /(^|[\\/])\.\.($|[\\/])/.test(rawEntry) || /[\\\u0000-\u001f]/.test(rawEntry)) {
      return NextResponse.json({ error: 'Invalid entry path — must be a relative path inside the project.' }, { status: 400 });
    }
    const entryPath = rawEntry.replace(/^\/+/, '');
    const entryFs = path.join(project.storagePath, entryPath);
    if (!fs.existsSync(entryFs)) {
      // offer the available HTML files to help the user pick
      const htmlFiles: string[] = [];
      (function walk(dir: string, rel: string) {
        for (const n of fs.readdirSync(dir)) {
          const full = path.join(dir, n);
          const r = rel ? `${rel}/${n}` : n;
          if (fs.statSync(full).isDirectory()) walk(full, r);
          else if (/\.(html?|htm)$/i.test(n)) htmlFiles.push(r);
        }
      })(project.storagePath, '');
      return NextResponse.json({
        error: `Entry HTML file "${entryPath}" was not found in the project.`,
        htmlFiles: htmlFiles.slice(0, 40),
        needsEntrySelection: true,
      }, { status: 422 });
    }

    // release keystore ownership check (needed for RELEASE APKs and every AAB)
    let releaseKeystoreId: string | null = null;
    if (cfg.buildType === 'RELEASE' || buildTargets !== 'APK') {
      const ks = await db.keystore.findUnique({ where: { id: String(cfg.releaseKeystoreId) } });
      if (!ks || ks.userId !== user.id) {
        return NextResponse.json({ error: 'Signing keystore not found or not owned by you.' }, { status: 404 });
      }
      releaseKeystoreId = ks.id;
    }

    const build = await db.build.create({
      data: {
        projectId: project.id,
        userId: user.id,
        status: 'QUEUED',
        buildType: String(cfg.buildType || 'DEBUG'),
        configJson: JSON.stringify({ ...cfg, buildTargets, entryPath, releaseKeystoreId }),
        logPath: path.join(config.logsDir, 'pending'),
        versionName: String(cfg.versionName || '1.0'),
        versionCode: Number(cfg.versionCode) || 1,
        packageName: String(cfg.packageName),
        appName: String(cfg.appName || 'My App'),
        expiresAt: new Date(Date.now() + config.retentionDays * 24 * 3600 * 1000),
      },
    });

    // kick off the build worker immediately (respects concurrency limits)
    void pumpQueue();

    return NextResponse.json({ buildId: build.id, status: 'QUEUED' }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
