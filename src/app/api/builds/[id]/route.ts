import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { janitor } from '@/lib/build-queue';
import { errorResponse, publicBuild } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** GET build status (owner or admin). Also triggers the janitor for staleness detection. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await janitor();
    const build = await db.build.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true, sourceType: true, originalName: true } } },
    });
    if (!build || (build.userId !== user.id && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Build not found.' }, { status: 404 });
    }
    return NextResponse.json({ build: { ...publicBuild(build), project: build.project } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE a build (owner only): removes artifacts, log and record. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const build = await db.build.findUnique({ where: { id } });
    if (!build || (build.userId !== user.id && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Build not found.' }, { status: 404 });
    }
    if (build.status === 'RUNNING') {
      return NextResponse.json({ error: 'This build is currently running. Cancel it first.' }, { status: 409 });
    }
    try { fs.rmSync(path.join(config.artifactsDir, id), { recursive: true, force: true }); } catch { }
    try { fs.rmSync(path.join(config.workspacesDir, id), { recursive: true, force: true }); } catch { }
    try { fs.rmSync(build.logPath, { force: true }); } catch { }
    try { fs.rmSync(path.join(config.logsDir, `${id}.log`), { force: true }); } catch { }
    await db.build.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
