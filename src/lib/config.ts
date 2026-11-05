import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/**
 * Central platform configuration for HTML2APK Studio.
 * All values are overridable via environment variables (see .env.example).
 */

export const ROOT = process.env.H2A_ROOT || process.cwd();

export const config = {
  appName: 'HTML2APK Studio',
  version: '1.0.0',

  // ---- Storage layout ----
  storageDir: process.env.H2A_STORAGE_DIR || path.join(ROOT, 'storage'),
  get uploadsDir() { return path.join(this.storageDir, 'uploads'); },
  get artifactsDir() { return path.join(this.storageDir, 'artifacts'); },
  get keystoresDir() { return path.join(this.storageDir, 'keystores'); },
  get workspacesDir() { return path.join(this.storageDir, 'workspaces'); },
  get logsDir() { return path.join(this.storageDir, 'logs'); },
  get keysDir() { return path.join(this.storageDir, 'keys'); },

  // ---- Android build toolchain ----
  // Defaults match `scripts/sdk-setup.sh` so a fresh clone works after running it.
  androidSdk: process.env.H2A_ANDROID_SDK || path.join(ROOT, 'android-sdk'),
  javaHome: process.env.H2A_JAVA_HOME
    || (fs.existsSync(path.join(ROOT, 'tools', 'jdk-21', 'bin', 'javac')) ? path.join(ROOT, 'tools', 'jdk-21') : '')
    || process.env.JAVA_HOME
    || '/usr/lib/jvm/java-21-openjdk-amd64',
  gradleHome: process.env.H2A_GRADLE_HOME || path.join(ROOT, 'tools', 'gradle-8.11.1'),
  gradleUserHome: process.env.H2A_GRADLE_USER_HOME || path.join(ROOT, '.gradle-home'),
  buildToolsVersion: process.env.H2A_BUILD_TOOLS || '36.0.0',
  compileSdk: 36,
  targetSdk: 36,
  minSdk: 24,
  agpVersion: '8.9.2',
  gradleExecutable: process.env.H2A_GRADLE_BIN || path.join(ROOT, 'tools', 'gradle-8.11.1', 'bin', 'gradle'),

  // ---- Limits ----
  maxUploadBytes: 50 * 1024 * 1024,        // 50 MB single upload (HTML or ZIP)
  maxHtmlBytes: 20 * 1024 * 1024,          // 20 MB single HTML entry
  maxFiles: 3000,                          // max entries in a ZIP project
  maxExtractBytes: 400 * 1024 * 1024,      // max total extracted size 400 MB
  maxIconBytes: 5 * 1024 * 1024,           // app icon upload limit
  maxKeystoreBytes: 1 * 1024 * 1024,       // keystore upload limit
  maxConcurrentBuilds: Number(process.env.H2A_MAX_CONCURRENT_BUILDS || 1),
  buildTimeoutMinutes: Number(process.env.H2A_BUILD_TIMEOUT_MIN || 25),

  // ---- Retention ----
  retentionDays: Number(process.env.H2A_RETENTION_DAYS || 7),
  workspaceCleanupHours: 3,

  // ---- Rate limits ----
  rateLimits: {
    auth: { limit: 15, windowMs: 60_000 },          // 15 req/min on auth endpoints
    upload: { limit: 20, windowMs: 60 * 60_000 },   // 20 uploads/hour
    build: { limit: 10, windowMs: 60 * 60_000 },    // 10 builds/hour
    api: { limit: 240, windowMs: 60_000 },          // general API 240 req/min
    download: { limit: 60, windowMs: 60_000 },
  },

  // ---- Auth ----
  sessionCookie: 'h2a_session',
  sessionDays: 7,
  secretFile: path.join(process.env.H2A_STORAGE_DIR || path.join(ROOT, 'storage'), '.h2a_secret'),

  // ---- Build engine ----
  workerScript: path.join(ROOT, 'scripts', 'build-worker.mjs'),
};

export function ensureStorageDirs() {
  for (const d of [config.uploadsDir, config.artifactsDir, config.keystoresDir, config.workspacesDir, config.logsDir, config.keysDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Persistent secret used for JWT signing and AES secret encryption. */
export function getOrCreateSecret(): string {
  ensureStorageDirs();
  try {
    const existing = fs.readFileSync(config.secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* not found, create below */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(config.secretFile, secret, { mode: 0o600 });
  return secret;
}

/** Human readable byte size. */
export function formatBytes(n?: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
