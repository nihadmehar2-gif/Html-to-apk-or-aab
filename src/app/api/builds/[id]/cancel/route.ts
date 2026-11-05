import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** POST cancel a queued/running build. Marks status; the worker's watchdog kills Gradle. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const build = await db.build.findUnique({ where: { id } });
    if (!build || (build.userId !== user.id && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Build not found.' }, { status: 404 });
    }
    if (!['QUEUED', 'RUNNING'].includes(build.status)) {
      return NextResponse.json({ error: `Build is already ${build.status.toLowerCase()}.` }, { status: 409 });
    }
    await db.build.update({
      where: { id },
      data: { status: 'CANCELLED', errorMessage: 'Cancelled by user.', finishedAt: new Date() },
    });
    // best-effort immediate termination of the worker process tree
    if (build.workerPid) {
      try { process.kill(-build.workerPid, 'SIGTERM'); } catch { /* worker may have exited */ }
    }
    return NextResponse.json({ ok: true, status: 'CANCELLED' });
  } catch (e) {
    return errorResponse(e);
  }
}
