import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyPassword, setSessionCookie } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/security';
import { config } from '@/lib/config';
import { ensureSeed } from '@/lib/seed';
import { errorResponse, zodMessage } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  try {
    await ensureSeed();
    const rl = rateLimit(`auth:${clientIp(req)}`, config.rateLimits.auth.limit, config.rateLimits.auth.windowMs);
    if (!rl.ok) {
      return NextResponse.json({ error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });

    const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    // uniform error message — do not reveal whether the account exists
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }
    if (user.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'This account has been suspended. Contact an administrator.' }, { status: 403 });
    }
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await setSessionCookie(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e) {
    return errorResponse(e);
  }
}
