import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSessionUser, requireUser, hashPassword, verifyPassword, clearSessionCookie } from '@/lib/auth';
import { errorResponse, zodMessage } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** GET current session user. */
export async function GET() {
  try {
    const user = await getSessionUser();
    return NextResponse.json({ user });
  } catch (e) {
    return errorResponse(e);
  }
}

const patchSchema = z.object({
  name: z.string().trim().max(80).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128).optional(),
});

/** PATCH account settings (name, password change). */
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });

    const data: { name?: string; passwordHash?: string } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.newPassword) {
      const user = await db.user.findUnique({ where: { id: session.id } });
      if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
      if (!parsed.data.currentPassword || !verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
        return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
      }
      data.passwordHash = hashPassword(parsed.data.newPassword);
    }
    const updated = await db.user.update({ where: { id: session.id }, data });
    return NextResponse.json({ user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE account (logs out). */
export async function DELETE() {
  try {
    await requireUser();
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
