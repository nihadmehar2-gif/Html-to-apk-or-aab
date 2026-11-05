import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { encryptSecret, rateLimit, clientIp } from '@/lib/security';
import { config, ensureStorageDirs } from '@/lib/config';
import { errorResponse, zodMessage } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** GET the user's saved keystores (no secrets returned). */
export async function GET() {
  try {
    const user = await requireUser();
    const keystores = await db.keystore.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, alias: true, commonName: true, organization: true, createdAt: true },
    });
    return NextResponse.json({ keystores });
  } catch (e) {
    return errorResponse(e);
  }
}

const genSchema = z.object({
  mode: z.literal('generate'),
  alias: z.string().trim().min(1).max(60).regex(/^[\w.-]+$/, 'Alias may contain letters, digits, _ . - only'),
  password: z.string().min(6, 'Keystore password must be at least 6 characters').max(128),
  commonName: z.string().trim().max(80).optional(),
  organization: z.string().trim().max(80).optional(),
});

/**
 * POST a signing keystore.
 *  - mode=generate: creates a new keystore with keytool (RSA 2048, 30-year validity)
 *  - mode=upload: accepts an existing .jks/.keystore file (multipart)
 * Passwords are validated, encrypted with AES-256-GCM and never stored in plaintext or logged.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    ensureStorageDirs();
    const rl = rateLimit(`ks:${user.id}:${clientIp(req)}`, 20, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many keystore operations. Try again shortly.' }, { status: 429 });

    const contentType = req.headers.get('content-type') || '';
    const ksDir = path.join(config.keystoresDir, user.id);
    fs.mkdirSync(ksDir, { recursive: true });

    if (contentType.includes('application/json')) {
      // ---- generate new keystore ----
      const body = await req.json().catch(() => ({}));
      const parsed = genSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
      const { alias, password, commonName, organization } = parsed.data;

      const id = crypto.randomUUID();
      const file = path.join(ksDir, `${id}.jks`);
      const dname = `CN=${commonName || 'HTML2APK Release'}${organization ? `,O=${organization}` : ''},C=US`;
      try {
        execFileSync('keytool', ['-genkeypair', '-v', '-keystore', file, '-storetype', 'JKS',
          '-storepass', password, '-alias', alias, '-keypass', password,
          '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950', '-dname', dname],
          { stdio: 'pipe', timeout: 60000 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'keytool failed';
        if (/exists/i.test(msg)) return NextResponse.json({ error: 'Internal collision, please retry.' }, { status: 500 });
        return NextResponse.json({ error: 'Keystore generation failed. Check the alias and password constraints.' }, { status: 400 });
      }
      const rec = await db.keystore.create({
        data: {
          userId: user.id, alias, filePath: file,
          passwordEnc: encryptSecret(password), keyPasswordEnc: encryptSecret(password),
          commonName: commonName || null, organization: organization || null,
        },
      });
      return NextResponse.json({ keystore: { id: rec.id, alias: rec.alias, commonName: rec.commonName, organization: rec.organization, createdAt: rec.createdAt } });
    }

    // ---- upload existing keystore ----
    const form = await req.formData();
    const file = form.get('file');
    const alias = String(form.get('alias') || '').trim();
    const password = String(form.get('password') || '');
    const keyPassword = String(form.get('keyPassword') || password);
    if (!(file instanceof File)) return NextResponse.json({ error: 'No keystore file received.' }, { status: 400 });
    if (file.size > config.maxKeystoreBytes) return NextResponse.json({ error: 'Keystore file too large (max 1 MB).' }, { status: 413 });
    if (!/\.(jks|keystore)$/i.test(file.name || '')) return NextResponse.json({ error: 'Keystore must be a .jks or .keystore file.' }, { status: 415 });
    if (!alias || !/^[\w.-]+$/.test(alias)) return NextResponse.json({ error: 'Key alias is required (letters, digits, _ . -).' }, { status: 400 });
    if (!password) return NextResponse.json({ error: 'Keystore password is required.' }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const id = crypto.randomUUID();
    const filePath = path.join(ksDir, `${id}.jks`);
    fs.writeFileSync(filePath, buf);

    // validate: keytool -list must succeed with the provided password
    try {
      execFileSync('keytool', ['-list', '-keystore', filePath, '-storepass', password], { stdio: 'pipe', timeout: 30000 });
    } catch {
      fs.rmSync(filePath, { force: true });
      return NextResponse.json({ error: 'Keystore validation failed: wrong password or corrupt keystore file.' }, { status: 400 });
    }
    const rec = await db.keystore.create({
      data: {
        userId: user.id, alias, filePath,
        passwordEnc: encryptSecret(password), keyPasswordEnc: encryptSecret(keyPassword),
      },
    });
    return NextResponse.json({ keystore: { id: rec.id, alias: rec.alias, commonName: rec.commonName, organization: rec.organization, createdAt: rec.createdAt } });
  } catch (e) {
    return errorResponse(e);
  }
}
