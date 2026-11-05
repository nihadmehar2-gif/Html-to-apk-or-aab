import { PrismaClient } from '@prisma/client'

/**
 * Thrown when the database cannot be used on the current host (e.g. a
 * serverless deployment without DATABASE_URL or a writable filesystem).
 * API routes translate this into a clean 503 via api-utils.errorResponse.
 */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super(
      'Database is not available on this host. Serverless hosting (Vercel etc.) has no persistent filesystem — accounts, uploads and builds need a real server. Deploy in one command with Docker: see DEPLOYMENT.md §9.'
    );
    this.name = 'DatabaseUnavailableError';
  }
}

/** Never-crashing db stub: any property access reports unavailability cleanly. */
function unavailableDb(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === 'then') return undefined; // never look like a thenable
      if (prop === '$connect' || prop === '$disconnect') return async () => undefined;
      throw new DatabaseUnavailableError();
    },
  });
}

function createDb(): PrismaClient {
  try {
    if (!process.env.DATABASE_URL) return unavailableDb();
    return new PrismaClient();
  } catch (e) {
    // e.g. client not generated or datasource misconfigured — keep module load
    // safe (this file is evaluated during `next build`) and fail cleanly at use.
    console.error('[db] Prisma client unavailable:', e instanceof Error ? e.message : e);
    return unavailableDb();
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
