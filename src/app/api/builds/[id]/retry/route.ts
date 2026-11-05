import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { pumpQueue } from '@/lib/build-queue';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/**
 * POST retry a failed/cancelled build: creates a fresh build with the same
 * configuration and queues it. The original record is kept for history.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const build = await db.build.findUnique({ where: { id } });
    if (!build || (build.userId !== user.id && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Build not found.' }, { status: 404 });
    }
    if (build.status === 'RUNNING' || build.status === 'QUEUED') {
      return NextResponse.json({ error: 'This build is already active.' }, { status: 409 });
    }
    const cfg = JSON.parse(build.configJson || '{}');
    const fresh = await db.build.create({
      data: {
        projectId: build.projectId,
        userId: build.userId,
        status: 'QUEUED',
        buildType: build.buildType,
        configJson: build.configJson,
        logPath: build.logPath,
        versionName: build.versionName,
        versionCode: build.versionCode,
        packageName: build.packageName,
        appName: build.appName,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    void cfg;
    void pumpQueue();
    return NextResponse.json({ buildId: fresh.id, status: 'QUEUED' }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
