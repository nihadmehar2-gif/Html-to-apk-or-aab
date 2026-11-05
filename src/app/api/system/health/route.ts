import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** GET public system health: whether the build engine is operational and queue depth. */
export async function GET() {
  try {
    const running = await db.build.count({ where: { status: 'RUNNING' } });
    const queued = await db.build.count({ where: { status: 'QUEUED' } });
    const engineReady =
      fs.existsSync(path.join(config.androidSdk, 'build-tools', config.buildToolsVersion, 'aapt2')) &&
      fs.existsSync(config.gradleExecutable) &&
      fs.existsSync(path.join(config.javaHome, 'bin', 'javac'));
    return NextResponse.json({
      ok: true,
      engineReady,
      queue: { running, queued, maxConcurrent: config.maxConcurrentBuilds },
      version: config.version,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
