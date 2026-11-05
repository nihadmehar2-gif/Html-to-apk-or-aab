import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { errorResponse, zodMessage } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  action: z.enum(['suspend', 'activate', 'promote', 'demote']),
});

/** PATCH a user: suspend/activate/promote/demote (admin only). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    if (id === admin.id) return NextResponse.json({ error: 'You cannot modify your own account.' }, { status: 400 });

    const target = await db.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    const data = {
      status: parsed.data.action === 'suspend' ? 'SUSPENDED' : 'ACTIVE',
      role: parsed.data.action === 'promote' ? 'ADMIN' : parsed.data.action === 'demote' ? 'USER' : undefined,
    };
    if (parsed.data.action === 'activate' && target.role) data.role = target.role;
    const updated = await db.user.update({ where: { id }, data });
    return NextResponse.json({ user: { id: updated.id, role: updated.role, status: updated.status } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE a user and all their data (admin only). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    if (id === admin.id) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    const target = await db.user.findUnique({ where: { id }, include: { builds: true, keystores: true } });
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    for (const b of target.builds) {
      try { fs.rmSync(path.join(config.artifactsDir, b.id), { recursive: true, force: true }); } catch { }
      try { fs.rmSync(path.join(config.workspacesDir, b.id), { recursive: true, force: true }); } catch { }
      try { fs.rmSync(path.join(config.logsDir, `${b.id}.log`), { force: true }); } catch { }
    }
    for (const ks of target.keystores) {
      try { fs.rmSync(ks.filePath, { force: true }); } catch { }
    }
    try { fs.rmSync(path.join(config.keystoresDir, id), { recursive: true, force: true }); } catch { }
    try { fs.rmSync(path.join(config.uploadsDir, id), { recursive: true, force: true }); } catch { }
    await db.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
