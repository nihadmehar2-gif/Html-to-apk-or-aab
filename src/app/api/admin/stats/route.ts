import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

function dirSize(dir: string): number {
  let total = 0;
  try {
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        const full = path.join(d, n);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else total += st.size;
      }
    })(dir);
  } catch { }
  return total;
}

/** GET admin dashboard statistics. */
export async function GET() {
  try {
    await requireAdmin();
    const [users, projects, succeeded, failed, active, downloads] = await Promise.all([
      db.user.count(),
      db.project.count(),
      db.build.count({ where: { status: 'SUCCEEDED' } }),
      db.build.count({ where: { status: { in: ['FAILED', 'CANCELLED'] } } }),
      db.build.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
      db.downloadLog.count(),
    ]);
    const apkBytes = dirSize(config.artifactsDir);
    const uploadBytes = dirSize(config.uploadsDir);
    const keystoreBytes = dirSize(config.keystoresDir);
    const workspaceBytes = dirSize(config.workspacesDir);

    let diskFree: number | null = null;
    let diskTotal: number | null = null;
    try {
      const st = fs.statfsSync('/');
      diskFree = st.bsize * st.bavail;
      diskTotal = st.bsize * st.blocks;
    } catch { }

    const recentBuilds = await db.build.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { project: { select: { name: true } }, user: { select: { email: true } } },
    });

    return NextResponse.json({
      totals: { users, projects, succeeded, failed, active, downloads },
      storage: { apkBytes, uploadBytes, keystoreBytes, workspaceBytes },
      disk: { free: diskFree, total: diskTotal },
      limits: {
        maxConcurrentBuilds: config.maxConcurrentBuilds,
        buildTimeoutMinutes: config.buildTimeoutMinutes,
        retentionDays: config.retentionDays,
        maxUploadMb: config.maxUploadBytes / 1024 / 1024,
      },
      recentBuilds: recentBuilds.map((b) => ({
        id: b.id, status: b.status, buildType: b.buildType, appName: b.appName,
        packageName: b.packageName, createdAt: b.createdAt,
        projectName: b.project?.name, userEmail: b.user?.email,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
