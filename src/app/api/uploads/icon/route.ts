import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireUser } from '@/lib/auth';
import { config, ensureStorageDirs } from '@/lib/config';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

/** POST app icon (PNG/JPEG/WebP) — stored and later resized per density by the build worker. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    ensureStorageDirs();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No icon file received.' }, { status: 400 });
    }
    if (file.size > config.maxIconBytes) {
      return NextResponse.json({ error: `Icon too large (max ${config.maxIconBytes / 1024 / 1024} MB).` }, { status: 413 });
    }
    const type = file.type || '';
    const nameOk = /\.(png|jpe?g|webp)$/i.test(file.name || '');
    if (!ALLOWED.includes(type) && !nameOk) {
      return NextResponse.json({ error: 'Icon must be a PNG, JPEG or WebP image.' }, { status: 415 });
    }
    // sanity: must decode as image
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) throw new Error('no dimensions');
      if (meta.width < 48 || meta.height < 48) {
        return NextResponse.json({ error: 'Icon must be at least 48×48 pixels (512×512 recommended).' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'The uploaded file could not be decoded as an image.' }, { status: 415 });
    }

    const iconId = crypto.randomUUID();
    const dir = path.join(config.uploadsDir, iconId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = type === 'image/png' || /\.png$/i.test(file.name) ? 'png' : type === 'image/webp' || /\.webp$/i.test(file.name) ? 'webp' : 'jpg';
    fs.writeFileSync(path.join(dir, `icon.${ext}`), buf);
    void user;
    return NextResponse.json({ iconId, ext });
  } catch (e) {
    return errorResponse(e);
  }
}
