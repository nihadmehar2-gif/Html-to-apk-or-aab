import { NextResponse } from 'next/server';
import { HttpError } from './auth';

/** Standard JSON error response from any thrown error. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : 'Internal server error';
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
