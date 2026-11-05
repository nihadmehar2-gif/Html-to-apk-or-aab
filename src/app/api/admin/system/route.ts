import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** GET build-engine system health (admin only). */
export async function GET() {
  try {
    await requireAdmin();
    const buildToolsDir = path.join(config.androidSdk, 'build-tools', config.buildToolsVersion);
    const toolCheck = {
      androidSdk: fs.existsSync(path.join(config.androidSdk, 'licenses')),
      buildTools: fs.existsSync(path.join(buildToolsDir, 'aapt2')),
      platformJar: fs.existsSync(path.join(config.androidSdk, 'platforms', `android-${config.compileSdk}`, 'android.jar')),
      gradle: fs.existsSync(config.gradleExecutable),
      java: fs.existsSync(path.join(config.javaHome, 'bin', 'javac')),
      template: fs.existsSync(path.join(ROOT_DIR(), 'android-template', 'app', 'src', 'main', 'java')),
    };
    const active = await db.build.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true, status: true, step: true, progress: true, createdAt: true, workerPid: true },
    });
    const workspaces = fs.existsSync(config.workspacesDir) ? fs.readdirSync(config.workspacesDir).length : 0;

    return NextResponse.json({
      engine: toolCheck,
      engineReady: Object.values(toolCheck).every(Boolean),
      activeJobs: active,
      workspaces,
      machine: {
        platform: os.platform(), release: os.release(), arch: os.arch(),
        cpus: os.cpus().length, loadAvg: os.loadavg(), memTotal: os.totalmem(), memFree: os.freemem(),
        uptime: os.uptime(),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

function ROOT_DIR(): string {
  return config.storageDir ? path.dirname(config.storageDir) : '/home/z/my-project';
}
