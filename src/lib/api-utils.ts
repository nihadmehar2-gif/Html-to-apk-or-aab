import { NextResponse } from 'next/server';
import { HttpError } from './auth';
import { DatabaseUnavailableError } from './db';

/** Standard JSON error response from any thrown error. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof DatabaseUnavailableError) {
    return NextResponse.json({ error: e.message, code: 'DB_UNAVAILABLE' }, { status: 503 });
  }
  const msg = e instanceof Error ? e.message : 'Internal server error';
  // Serverless hosts: translate environment limitations into honest 503s
  // instead of opaque 500s.
  // Note: on read-only filesystems (Vercel etc.) Node's recursive mkdirSync
  // often reports ENOENT instead of EROFS — hence the second pattern.
  if (
    /EROFS|EACCES|EPERM|ENOSPC|read-only file system|readonly file system/i.test(msg) ||
    /ENOENT: no such file or directory, (mkdir|open|writeFile|scandir|readdir|copyfile|rename|unlink|utimes|chmod)/i.test(msg)
  ) {
    return NextResponse.json({ error: 'This host has a read-only filesystem (serverless hosting). Uploads, keystores and build artifacts require persistent storage — deploy with Docker in one command (see DEPLOYMENT.md §9).', code: 'NO_PERSISTENT_STORAGE' }, { status: 503 });
  }
  if (/P1001|P1003|P2021|did not initialize yet|Environment variable not found: DATABASE_URL|Can't reach database server/i.test(msg)) {
    return NextResponse.json({ error: 'Database is not available on this host (serverless hosting). Deploy on a server with persistent storage — see DEPLOYMENT.md §9.', code: 'DB_UNAVAILABLE' }, { status: 503 });
  }
  console.error('[api]', msg);
  return NextResponse.json({ error: msg }, { status: 500 });
}

/** Extracts the first human-readable message from a Zod error. */
export function zodMessage(e: unknown): string {
  const issues = (e as { issues?: { message: string }[] })?.issues;
  if (issues && issues.length > 0) return issues[0].message;
  return 'Invalid input.';
}

/** Strips volatile fields before returning a build/project record to clients. */
export function publicBuild(b: Record<string, unknown>) {
  const { configJson, logPath, apkPath, aabPath, workerPid, ...rest } = b as Record<string, unknown>;
  let cfg: unknown = undefined;
  try { cfg = JSON.parse(String(configJson)); } catch { /* ignore */ }
  return { ...rest, config: cfg, hasApk: Boolean(apkPath), hasAab: Boolean(aabPath) };
}
