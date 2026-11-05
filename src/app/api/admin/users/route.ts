import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

/** GET all users with aggregate build counts (admin only). */
export async function GET() {
  try {
    await requireAdmin();
    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        createdAt: true, lastLoginAt: true,
        _count: { select: { projects: true, builds: true } },
      },
    });
    return NextResponse.json({ users });
  } catch (e) {
    return errorResponse(e);
  }
}
