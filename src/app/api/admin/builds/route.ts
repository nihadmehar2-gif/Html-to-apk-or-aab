import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { janitor } from '@/lib/build-queue';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** GET all builds (admin only), filterable by ?status= */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await janitor();
    const status = req.nextUrl.searchParams.get('status');
    const builds = await db.build.findMany({
      where: status && status !== 'all' ? { status: status.toUpperCase() } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        project: { select: { name: true, sourceType: true } },
        user: { select: { email: true, name: true } },
      },
    });
    return NextResponse.json({
      builds: builds.map((b) => ({
        id: b.id, status: b.status, buildType: b.buildType, step: b.step, progress: b.progress,
        appName: b.appName, packageName: b.packageName, versionName: b.versionName,
        apkSize: b.apkSize, aabSize: b.aabSize, errorMessage: b.errorMessage,
        createdAt: b.createdAt, finishedAt: b.finishedAt,
        project: b.project, user: b.user,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
