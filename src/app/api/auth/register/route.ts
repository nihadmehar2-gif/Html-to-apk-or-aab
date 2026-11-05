import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { hashPassword, setSessionCookie } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/security';
import { config } from '@/lib/config';
import { ensureSeed } from '@/lib/seed';
import { errorResponse, zodMessage } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email('Please enter a valid email address').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().trim().max(80).optional(),
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

    const { email, password, name } = parsed.data;
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists. Please log in.' }, { status: 409 });
    }
    const user = await db.user.create({
      data: {
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        passwordHash: hashPassword(password),
        role: 'USER',
      },
    });
    await setSessionCookie(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e) {
    return errorResponse(e);
  }
}
