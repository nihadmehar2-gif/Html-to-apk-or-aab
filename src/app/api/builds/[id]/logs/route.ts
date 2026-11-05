import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/**
 * GET incremental build logs: ?offset=<byteOffset>
 * Returns the new bytes since the offset plus the current total size.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const build = await db.build.findUnique({ where: { id } });
    if (!build || (build.userId !== user.id && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Build not found.' }, { status: 404 });
    }
    const logFile = path.join(config.logsDir, `${id}.log`);
    let offset = Number(req.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    let total = 0;
    try { total = fs.statSync(logFile).size; } catch {
      return NextResponse.json({ chunk: '', total: 0, offset });
    }
    if (offset > total) offset = 0; // log was truncated/rotated

    const len = Math.min(total - offset, 512 * 1024);
    const buf = Buffer.alloc(len);
    if (len > 0) {
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buf, 0, len, offset);
      fs.closeSync(fd);
    }
    return NextResponse.json({
      chunk: buf.toString('utf8'),
      total,
      offset: offset + len,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
