import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { config, ensureStorageDirs, ROOT } from './config';
import { db } from './db';

/**
 * Build job queue: spawns detached worker processes and enforces:
 *  - max concurrent builds
 *  - atomic QUEUED → RUNNING claims (no duplicate Gradle processes)
 *  - stale worker detection (heartbeat + pid)
 *  - retention cleanup (expired artifacts)
 *  - workspace cleanup
 */

function pidAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawns the detached worker for a claimed build.
 * The caller MUST have transitioned the build to RUNNING (atomic claim) first.
 */
function spawnWorker(buildId: string): void {
  ensureStorageDirs();
  const logFile = path.join(config.logsDir, `${buildId}.log`);
  const out = fs.openSync(logFile, 'a');
  const nodeBin = process.execPath || 'node';
  const child = spawn(nodeBin, [config.workerScript], {
    env: {
      ...process.env,
      H2A_BUILD_ID: buildId,
      H2A_ROOT: ROOT,
      H2A_MAVEN_MIRROR: process.env.H2A_MAVEN_MIRROR || 'aliyun',
      H2A_RETENTION_DAYS: String(config.retentionDays),
      H2A_BUILD_TIMEOUT_MIN: String(config.buildTimeoutMinutes),
      JAVA_HOME: config.javaHome,
      H2A_JAVA_HOME: config.javaHome,
    },
    cwd: path.dirname(config.workerScript),
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.closeSync(out);
  void db.build.update({ where: { id: buildId }, data: { workerPid: child.pid } }).catch(() => { });
}

/**
 * Starts queued builds while concurrency slots are free.
 * Every claim is atomic: `updateMany` with a status guard so two concurrent
 * callers (API request + janitor) can never start the same build twice.
 */
export async function pumpQueue(): Promise<void> {
  const running = await db.build.count({ where: { status: 'RUNNING' } });
  let free = config.maxConcurrentBuilds - running;
  if (free <= 0) return;
  const queued = await db.build.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: free * 3, // headroom: some rows may be claimed already or have live workers
  });
  for (const b of queued) {
    if (free <= 0) break;
    if (b.workerPid && pidAlive(b.workerPid)) continue; // already has a live worker
    // atomic claim: transition QUEUED → RUNNING exactly once
    const claimed = await db.build.updateMany({
      where: { id: b.id, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (claimed.count !== 1) continue; // lost the race — someone else claimed it
    try {
      spawnWorker(b.id);
      free--;
    } catch {
      // spawn failed: put it back so the janitor/user retry can pick it up
      await db.build.update({
        where: { id: b.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Build worker could not be started (runtime missing?). Check server logs and retry the build.',
          finishedAt: new Date(),
        },
      }).catch(() => { });
    }
  }
}

/**
 * Janitor: run periodically (called lazily by status endpoints).
 *  - marks RUNNING builds with stale heartbeat (>2 min) as FAILED
 *  - marks SUCCEEDED builds past expiresAt as EXPIRED and deletes artifacts
 *  - deletes workspaces older than workspaceCleanupHours for finished builds
 *  - pumps the queue
 */
export async function janitor(): Promise<void> {
  try {
    const now = Date.now();

    // stale running builds (grace period right after claim, before the worker
    // process has written its first heartbeat)
    const running = await db.build.findMany({ where: { status: 'RUNNING' } });
    for (const b of running) {
      const startedMs = b.startedAt ? b.startedAt.getTime() : 0;
      if (now - startedMs < 90 * 1000) continue; // startup grace: worker may still be booting
      const hb = path.join(config.workspacesDir, b.id, '.heartbeat');
      let stale = false;
      try {
        const st = fs.statSync(hb);
        stale = now - st.mtimeMs > 2 * 60 * 1000;
      } catch {
        stale = true; // no heartbeat file
      }
      if (stale && !pidAlive(b.workerPid)) {
        await db.build.update({
          where: { id: b.id },
          data: { status: 'FAILED', errorMessage: 'Build worker died unexpectedly or timed out. Please retry the build.', finishedAt: new Date() },
        }).catch(() => { });
      }
    }

    // retention: expire old artifacts
    const expired = await db.build.findMany({ where: { status: 'SUCCEEDED', expiresAt: { lt: new Date() } } });
    for (const b of expired) {
      try { fs.rmSync(path.join(config.artifactsDir, b.id), { recursive: true, force: true }); } catch { }
      await db.build.update({ where: { id: b.id }, data: { status: 'EXPIRED' } }).catch(() => { });
    }

    // cleanup old workspaces of finished builds
    const cutoff = now - config.workspaceCleanupHours * 3600 * 1000;
    const finished = await db.build.findMany({
      where: { status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] }, finishedAt: { lt: new Date(cutoff) } },
      select: { id: true },
    });
    for (const b of finished) {
      try { fs.rmSync(path.join(config.workspacesDir, b.id), { recursive: true, force: true }); } catch { }
    }

    // pump queue
    await pumpQueue();
  } catch {
    // janitor must never throw into request handling
  }
}
