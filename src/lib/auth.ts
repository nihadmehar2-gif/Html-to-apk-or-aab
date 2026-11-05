import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { config, getOrCreateSecret } from './config';
import { db } from './db';

/**
 * Authentication: scrypt password hashing + JWT session cookies (httpOnly).
 * No plaintext passwords are ever stored or logged.
 */

const secret = new TextEncoder().encode(getOrCreateSecret());

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
};

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('html2apk-studio')
    .setExpirationTime(`${config.sessionDays}d`)
    .sign(secret);
}

export async function setSessionCookie(userId: string) {
  const token = await createSessionToken(userId);
  const jar = await cookies();
  jar.set(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // sandbox gateway terminates TLS; set true behind HTTPS in production
    maxAge: config.sessionDays * 24 * 3600,
    path: '/',
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(config.sessionCookie, '', { httpOnly: true, maxAge: 0, path: '/' });
}

/** Returns the authenticated user (from session cookie) or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(config.sessionCookie)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret, { issuer: 'html2apk-studio' });
    if (!payload.sub) return null;
    const user = await db.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role as 'USER' | 'ADMIN' };
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Throws 401 if not logged in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Authentication required. Please log in.');
  return user;
}

/** Throws 403 if not an admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new HttpError(403, 'Administrator access required.');
  return user;
}
