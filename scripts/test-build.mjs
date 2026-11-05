#!/usr/bin/env node
/**
 * E2E pre-warm test: creates a real build record in the DB (sample ZIP website),
 * runs the actual build worker synchronously and prints the result.
 * Usage: node scripts/test-build.mjs [DEBUG|RELEASE] [--targets APK|AAB|BOTH] [--keep]
 * Legacy: --aab is equivalent to --targets BOTH (release builds) for compat.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const ROOT = '/home/z/my-project';
const STORAGE = path.join(ROOT, 'storage');
const buildType = (process.argv[2] || 'DEBUG').toUpperCase();
const wantAab = process.argv.includes('--aab');
const targetsIdx = process.argv.indexOf('--targets');
const targets = (targetsIdx >= 0 ? process.argv[targetsIdx + 1] : (wantAab ? 'BOTH' : 'APK')).toUpperCase();
if (!['APK', 'AAB', 'BOTH'].includes(targets)) {
  console.error(`Invalid targets "${targets}" — use APK, AAB or BOTH`);
  process.exit(1);
}

const SITE = {
  'index.html': `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prewarm Test</title><link rel="stylesheet" href="style.css"></head>
<body><h1 id="t">Prewarm Test</h1><p class="js">JS: off</p><img src="img/dot.svg" width="16" alt="">
<script src="app.js"></script></body></html>`,
  'style.css': `body{font-family:sans-serif;background:#0f172a;color:#fff;text-align:center;padding:40px}
h1{color:#10b981}`,
  'app.js': `document.getElementById('t').textContent += ' — loaded';
document.querySelector('.js').textContent = 'JS: works';`,
  'img/dot.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#10b981"/></svg>`,
};

async function main() {
  const stamp = Date.now();
  const uploadDir = path.join(STORAGE, 'uploads', `test-${stamp}`);
  fs.mkdirSync(uploadDir, { recursive: true });
  // Build a real ZIP archive of the sample site (matches a real user upload)
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  for (const [rel, content] of Object.entries(SITE)) zip.addFile(rel, Buffer.from(content));
  fs.writeFileSync(path.join(uploadDir, 'original.zip'), zip.toBuffer());

  const user = await db.user.upsert({
    where: { email: 'prewarm@html2apk.studio' },
    update: {},
    create: { email: `prewarm@html2apk.studio`, name: 'Prewarm', passwordHash: 'x' },
  });

  const project = await db.project.create({
    data: {
      userId: user.id,
      name: `Prewarm ${stamp}`,
      sourceType: 'ZIP',
      originalName: 'prewarm.zip',
      size: 1200,
      fileCount: 4,
      entryPath: 'index.html',
      storagePath: uploadDir,
    },
  });

  const config = {
    appName: 'Prewarm Test App',
    packageName: 'studio.html2apk.prewarm' + (stamp % 10000),
    versionName: '1.0.0',
    versionCode: 1,
    description: 'prewarm',
    language: 'en',
    themeColor: '#10B981',
    iconId: null,
    splashEnabled: true,
    splashColor: '#0F172A',
    orientation: 'portrait',
    fullscreen: false,
    statusBarVisible: true,
    statusBarColor: '#0F172A',
    navigationBarColor: '#0F172A',
    brightness: 'system',
    javascriptEnabled: true,
    domStorageEnabled: true,
    databaseEnabled: false,
    zoomControls: false,
    textZoom: 100,
    allowFileAccess: true,
    externalLinks: 'external',
    cacheMode: 'default',
    mixedContent: 'never',
    openFileChooser: true,
    downloadsEnabled: true,
    userAgentSuffix: '',
    permissions: { internet: true, camera: false, microphone: false, location: false, fileAccess: false, notifications: false },
    buildType,
    buildTargets: targets,
    generateAab: targets !== 'APK', // kept in sync for legacy compatibility
    entryPath: 'index.html',
  };

  const build = await db.build.create({
    data: {
      projectId: project.id,
      userId: user.id,
      status: 'QUEUED',
      buildType,
      configJson: JSON.stringify(config),
      logPath: path.join(STORAGE, 'logs', 'prewarm.log'),
      versionName: config.versionName,
      versionCode: config.versionCode,
      packageName: config.packageName,
      appName: config.appName,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  });

  console.log(`Created build ${build.id} (type=${buildType}, targets=${targets}) — starting worker...`);
  const env = { ...process.env, H2A_BUILD_ID: build.id, H2A_ROOT: ROOT, H2A_MAVEN_MIRROR: 'aliyun' };
  if (buildType === 'RELEASE' || targets !== 'APK') {
    // generate a throwaway release keystore for the prewarm test
    const ksDir = path.join(STORAGE, 'keys');
    fs.mkdirSync(ksDir, { recursive: true });
    const ksFile = path.join(ksDir, `prewarm-${stamp}.jks`);
    const kt = spawnSync('keytool', ['-genkeypair', '-v', '-keystore', ksFile, '-storepass', 'prewarm123',
      '-alias', 'prewarm', '-keypass', 'prewarm123', '-keyalg', 'RSA', '-keysize', '2048',
      '-validity', '30', '-dname', 'CN=Prewarm,O=Test,C=US'], { stdio: 'pipe' });
    if (kt.status !== 0) { console.error('keytool failed', kt.stderr.toString()); process.exit(1); }
    env.KEYSTORE_FILE = ksFile;
    env.KEY_ALIAS = 'prewarm';
    env.KEYSTORE_PASSWORD = 'prewarm123';
    env.KEY_PASSWORD = 'prewarm123';
  }

  const started = Date.now();
  const worker = spawnSync('node', [path.join(ROOT, 'scripts', 'build-worker.mjs')], {
    env, cwd: ROOT, stdio: 'inherit', timeout: 29 * 60 * 1000,
  });
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`Worker exited with code ${worker.status} after ${mins} min`);

  const after = await db.build.findUnique({ where: { id: build.id } });
  console.log(JSON.stringify({
    status: after.status, step: after.step, progress: after.progress,
    apkSize: after.apkSize, aabSize: after.aabSize, error: after.errorMessage,
  }, null, 2));
  process.exit(after.status === 'SUCCEEDED' ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
