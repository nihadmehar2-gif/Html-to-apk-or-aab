import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/security';
import { config } from '@/lib/config';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
  aab: 'application/octet-stream',
  logs: 'text/plain; charset=utf-8',
};

/**
 * GET download a build artifact: ?type=apk|aab|logs
 * Security checks: authenticated, owner (or admin), build SUCCEEDED and not
 * expired, artifact exists and is non-empty. Every download is logged.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`dl:${user.id}:${clientIp(req)}`, config.rateLimits.download.limit, config.rateLimits.download.windowMs);
    if (!rl.ok) return NextResponse.json({ error: 'Too many download requests.' }, { status: 429 });

    const { id } = await ctx.params;
    const type = req.nextUrl.searchParams.get('type') || 'apk';
    if (!['apk', 'aab', 'logs'].includes(type)) {
      return NextResponse.json({ error: 'Invalid artifact type.' }, { status: 400 });
    }

    const build = await db.build.findUnique({ where: { id }, include: { project: true } });
    if (!build || (build.userId !== user.id && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Build not found.' }, { status: 404 });
    }
    if (build.status === 'EXPIRED') {
      return NextResponse.json({ error: 'This build has expired and its files were removed (7-day retention).' }, { status: 410 });
    }
    if (build.status !== 'SUCCEEDED') {
      return NextResponse.json({ error: `Build is not finished (status: ${build.status}). No files are available yet.` }, { status: 409 });
    }
    if (build.expiresAt && build.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: 'This build has expired.' }, { status: 410 });
    }

    let filePath: string | null = null;
    let downloadName: string;
    const safeName = `${(build.appName || 'app').replace(/[^a-zA-Z0-9._-]+/g, '-')}-v${build.versionName}-${build.buildType.toLowerCase()}`;

    if (type === 'apk') {
      filePath = build.apkPath;
      downloadName = `${safeName}.apk`;
    } else if (type === 'aab') {
      filePath = build.aabPath;
      downloadName = `${safeName}.aab`;
      if (!filePath) return NextResponse.json({ error: 'No AAB was generated for this build.' }, { status: 404 });
    } else {
      filePath = path.join(config.logsDir, `${id}.log`);
      downloadName = `${safeName}-build-logs.txt`;
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'The artifact file is missing from storage. It may have been cleaned up — rebuild to regenerate.' }, { status: 410 });
    }
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return NextResponse.json({ error: 'The artifact file is empty. Please rebuild.' }, { status: 500 });
    }

    if (type !== 'logs') {
      await db.build.update({ where: { id }, data: { downloadCount: { increment: 1 } } });
    }
    await db.downloadLog.create({
      data: { buildId: id, userId: user.id, fileType: type.toUpperCase(), ip: clientIp(req) },
    });

    const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        'Content-Type': MIME[type],
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
