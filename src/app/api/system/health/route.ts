import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * GET public system health: hosting type, database availability, build engine
 * readiness and queue depth. Always returns 200 so clients (and the UI banner)
 * can inspect WHAT is missing instead of guessing from a failed request.
 */
export async function GET() {
  const hosting = process.env.VERCEL ? 'serverless' : 'server';
  let dbAvailable = true;
  let running = 0;
  let queued = 0;
  try {
    running = await db.build.count({ where: { status: 'RUNNING' } });
    queued = await db.build.count({ where: { status: 'QUEUED' } });
  } catch {
    dbAvailable = false;
  }
  const engineReady =
    fs.existsSync(path.join(config.androidSdk, 'build-tools', config.buildToolsVersion, 'aapt2')) &&
    fs.existsSync(config.gradleExecutable) &&
    fs.existsSync(path.join(config.javaHome, 'bin', 'javac'));
  return NextResponse.json({
    ok: true,
    hosting,
    dbAvailable,
    engineReady,
    buildsSupported: hosting === 'server' && dbAvailable && engineReady,
    queue: { running, queued, maxConcurrent: config.maxConcurrentBuilds },
    version: config.version,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
