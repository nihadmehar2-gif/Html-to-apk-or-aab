import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config, getOrCreateSecret } from './config';

/**
 * Security helpers: in-memory rate limiting, AES-256-GCM secret encryption,
 * upload validation, ZIP entry sanitization and safe extraction rules.
 * Uploaded projects are treated strictly as untrusted input.
 */

// ---------- Rate limiting (sliding window, per process) ----------
type Bucket = { hits: number[]; };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key) || { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    buckets.set(key, b);
    const retryAfterSec = Math.ceil((windowMs - (now - b.hits[0])) / 1000);
    return { ok: false, retryAfterSec };
  }
  b.hits.push(now);
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    // simple cleanup of stale buckets
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => now - t > windowMs)) buckets.delete(k);
    }
  }
  return { ok: true, retryAfterSec: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'local';
}

// ---------- AES-256-GCM secret encryption (keystore passwords) ----------
function aesKey(): Buffer {
  return crypto.createHash('sha256').update(getOrCreateSecret()).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// ---------- Upload validation ----------
export function detectFileKind(filename: string, buf: Buffer, mime: string): 'HTML' | 'ZIP' | null {
  const lower = filename.toLowerCase();
  // ZIP magic: PK\x03\x04
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7)) {
    return 'ZIP';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    // content sniff: must look like markup
    const head = buf.subarray(0, 4096).toString('utf8').toLowerCase();
    if (head.includes('<!doctype') || head.includes('<html') || head.includes('<head') || head.includes('<body') || head.includes('<div') || head.includes('<script')) {
      return 'HTML';
    }
  }
  void mime;
  return null;
}

// ---------- ZIP entry sanitization ----------
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export type ZipCheckResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

/**
 * Validates a ZIP entry name. Rejects absolute paths, path traversal,
 * illegal control characters, reserved Windows device names.
 */
export function checkZipEntryName(rawName: string): ZipCheckResult {
  if (rawName.startsWith('/') || rawName.startsWith('\\')) return { ok: false, reason: `absolute path not allowed: ${rawName}` };
  if (/^[a-zA-Z]:[\\/]/.test(rawName)) return { ok: false, reason: `drive-absolute path not allowed: ${rawName}` };
  if (/[\u0000-\u001f<>:"|?*]/.test(rawName.replace(/\//g, ''))) return { ok: false, reason: `illegal characters in name: ${rawName}` };
  const parts = rawName.split(/[\\/]/);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') return { ok: false, reason: `path traversal not allowed: ${rawName}` };
    if (WINDOWS_RESERVED.test(part)) return { ok: false, reason: `reserved device name not allowed: ${rawName}` };
    normalized.push(part);
  }
  if (normalized.length === 0) return { ok: true, normalized: '' }; // pure directory root
  const joined = normalized.join('/');
  if (joined.length > 240) return { ok: false, reason: `entry name too long: ${rawName.slice(0, 80)}…` };
  return { ok: true, normalized: joined };
}

/**
 * Extracts an adm-zip object safely into targetDir, enforcing limits.
 * Throws Error with a user-readable message on any violation.
 */
export async function safeExtractZip(
  zipBuffer: Buffer,
  targetDir: string,
  opts: { maxFiles: number; maxExtractBytes: number; maxEntryBytes: number },
): Promise<{ fileCount: number; totalBytes: number; files: { path: string; size: number }[] }> {
  // adm-zip is loaded lazily to keep this module importable in any context
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const visible = entries.filter((e) => !e.entryName.startsWith('__MACOSX/') && e.entryName.split('/').pop() !== '.DS_Store');
  if (visible.length > opts.maxFiles) {
    throw new Error(`ZIP contains too many entries (${visible.length}). Maximum allowed is ${opts.maxFiles}.`);
  }
  let total = 0;
  const files: { path: string; size: number }[] = [];
  for (const entry of visible) {
    // validate BOTH the raw stored name (defense against sanitizing readers)
    // and the normalized name
    const rawName = entry.rawEntryName ? entry.rawEntryName.toString('utf8') : entry.entryName;
    const checkRaw = checkZipEntryName(rawName);
    if (!checkRaw.ok) throw new Error(`Unsafe ZIP entry rejected — ${checkRaw.reason}`);
    const check = checkZipEntryName(entry.entryName);
    if (!check.ok) throw new Error(`Unsafe ZIP entry rejected — ${check.reason}`);
    if (entry.isDirectory) continue;
    const normalized = check.normalized;
    if (!normalized) continue;
    const size = entry.header.size;
    if (size > opts.maxEntryBytes) throw new Error(`Entry exceeds per-file limit: ${normalized}`);
    total += size;
    if (total > opts.maxExtractBytes) throw new Error('ZIP decompressed size exceeds the maximum allowed total (400 MB).');

    // symlink-like or mode bits are ignored: adm-zip extracts file data only
    const dest = path.join(targetDir, normalized);
    const destDir = path.dirname(dest);
    // final traversal guarantee: resolved path must stay inside targetDir
    if (!path.resolve(destDir).startsWith(path.resolve(targetDir))) {
      throw new Error(`Unsafe ZIP entry escapes target directory: ${entry.entryName}`);
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    files.push({ path: normalized, size });
  }
  return { fileCount: files.length, totalBytes: total, files };
}

// ---------- Android config validation ----------
export const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]{1,})+$/;
export const JAVA_KEYWORDS = new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null']);

export function validatePackageName(pkg: string): string | null {
  if (!pkg || pkg.length > 100) return 'Package name must be 1-100 characters.';
  if (!PKG_RE.test(pkg)) return 'Package name must be reverse-domain style, e.g. com.example.myapp (segments: lowercase letters, digits, underscore; must contain at least one dot).';
  for (const seg of pkg.split('.')) {
    if (JAVA_KEYWORDS.has(seg)) return `"${seg}" is a reserved Java keyword and cannot be used in the package name.`;
  }
  if (pkg.startsWith('java.') || pkg.startsWith('android.') || pkg.startsWith('com.android.') || pkg.startsWith('com.google.')) {
    return 'Package name may not start with java., android., com.android. or com.google.';
  }
  return null;
}

export function validateVersionName(v: string): string | null {
  if (!/^\d{1,3}(\.\d{1,3}){0,3}$/.test(v)) return 'Version name must look like 1.0, 2.3.1 (numbers separated by dots).';
  return null;
}

export function validateHexColor(c: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return 'Colors must be 6-digit hex, e.g. #10B981.';
  return null;
}
