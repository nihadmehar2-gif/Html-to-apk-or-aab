import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** DELETE a saved keystore (removes record + file). Only the owner can delete. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const ks = await db.keystore.findUnique({ where: { id } });
    if (!ks || ks.userId !== user.id) {
      return NextResponse.json({ error: 'Keystore not found.' }, { status: 404 });
    }
    try { fs.rmSync(ks.filePath, { force: true }); } catch { }
    await db.keystore.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
