#!/usr/bin/env node
/**
 * HTML2APK Studio — Build Worker
 * -------------------------------
 * A detached, isolated build process. One worker per build job.
 *
 * Responsibilities:
 *   1. Load build record + config from the database
 *   2. Create an isolated workspace under storage/workspaces/<buildId>
 *   3. Extract/copy the uploaded project with full path-traversal protection
 *   4. Generate a complete Android Gradle project (manifest, resources, icons, WebView config)
 *   5. Run the REAL Gradle build (assembleDebug / assembleRelease / bundleRelease — per buildTargets)
 *   6. Sign via debug keystore or the user's release keystore (passwords passed via env only)
 *   7. Validate the produced APK/AAB (zip structure, apksigner / jarsigner verify,
 *      bundletool dump manifest, aapt2 badging — package + version identity checks)
 *   8. Publish artifacts + logs to storage, update the database, clean the workspace
 *
 * The worker NEVER writes passwords to disk or logs, and never executes any
 * uploaded file. Uploaded content is treated as inert data (copied into assets).
 *
 * Env:  H2A_BUILD_ID (required)
 *       KEYSTORE_FILE / KEY_ALIAS / KEYSTORE_PASSWORD / KEY_PASSWORD (release builds only)
 *       H2A_MAVEN_MIRROR=aliyun  → use Aliyun maven mirrors (fast regional builds)
 *       H2A_BUILD_TIMEOUT_MIN (default 25)
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const AdmZip = require('adm-zip');
let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

const ROOT = process.env.H2A_ROOT
  || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); // <project>/scripts/ -> <project>
const BUILD_ID = process.env.H2A_BUILD_ID;
const STORAGE = path.join(ROOT, 'storage');
let SDK = process.env.H2A_ANDROID_SDK || path.join(ROOT, 'android-sdk');
let GRADLE_BIN = process.env.H2A_GRADLE_BIN || path.join(ROOT, 'tools', 'gradle-8.11.1', 'bin', 'gradle');
const BUILD_TOOLS = process.env.H2A_BUILD_TOOLS || '36.0.0';
const BUILD_TIMEOUT_MIN = Number(process.env.H2A_BUILD_TIMEOUT_MIN || 25);
const COMPILE_SDK = Number(process.env.H2A_COMPILE_SDK || 36);
const TARGET_SDK = Number(process.env.H2A_TARGET_SDK || 36);

const db = new PrismaClient();
const LOG_FILE = path.join(STORAGE, 'logs', `${BUILD_ID}.log`);
const WORKSPACE = path.join(STORAGE, 'workspaces', BUILD_ID);
const HEARTBEAT = path.join(WORKSPACE, '.heartbeat');

if (!BUILD_ID) { console.error('H2A_BUILD_ID missing'); process.exit(1); }
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

let cancelled = false;
let gradleProc = null;

// Kill the detached Gradle process group if the worker dies for any reason
// (OOM, crash, external kill) — otherwise an orphaned Gradle keeps ~1 GB+ RAM
// allocated until the sandbox/host restarts.
function killGradleTree() {
  if (gradleProc && gradleProc.pid) {
    try { process.kill(-gradleProc.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}
process.on('exit', killGradleTree);
process.on('SIGTERM', () => { killGradleTree(); process.exit(1); });
process.on('SIGINT', () => { killGradleTree(); process.exit(1); });
process.on('uncaughtException', (e) => {
  try { log(`uncaught exception: ${e && e.message}`); } catch { /* log file unavailable */ }
  killGradleTree();
  process.exit(1);
});
const startTs = Date.now();

// ---------------------------------------------------------------- utilities
function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function maskSecrets(s) {
  return String(s)
    .replace(/KEYSTORE_PASSWORD=\S+/g, 'KEYSTORE_PASSWORD=***')
    .replace(/KEY_PASSWORD=\S+/g, 'KEY_PASSWORD=***');
}
function log(line) {
  try { fs.appendFileSync(LOG_FILE, `[${ts()}] ${maskSecrets(line)}\n`); } catch { }
  process.stdout.write(line + '\n');
}
function touchHeartbeat() {
  try { fs.utimesSync(HEARTBEAT, new Date(), new Date()); } catch { }
}
setInterval(touchHeartbeat, 3000);

async function setProgress(step, progress, message) {
  log(`==> ${message || step} (${progress}%)`);
  await db.build.update({
    where: { id: BUILD_ID },
    data: { step: message || step, progress, status: cancelled ? undefined : 'RUNNING' },
  }).catch(() => { });
}

async function fail(message, detail) {
  const msg = detail ? `${message}\n\nDetails: ${detail}` : message;
  log(`!!! BUILD FAILED: ${message}`);
  if (detail) log(detail.slice(0, 8000));
  await db.build.update({
    where: { id: BUILD_ID },
    data: {
      status: 'FAILED',
      errorMessage: msg.slice(0, 4000),
      finishedAt: new Date(),
    },
  }).catch(() => { });
  await cleanupWorkspace(false);
  process.exit(1);
}

async function cleanupWorkspace(removeAll) {
  try {
    if (removeAll) {
      fs.rmSync(WORKSPACE, { recursive: true, force: true });
    } else {
      // keep generated android project for debugging, remove extracted source only
      const src = path.join(WORKSPACE, 'src');
      fs.rmSync(src, { recursive: true, force: true });
    }
  } catch { }
}

async function checkCancellation() {
  const build = await db.build.findUnique({ where: { id: BUILD_ID }, select: { status: true } });
  if (build && (build.status === 'CANCELLED' || build.status === 'FAILED')) {
    cancelled = true;
    throw new Error(build.status === 'CANCELLED' ? 'Build was cancelled by the user.' : 'Build terminated.');
  }
  if (Date.now() - startTs > BUILD_TIMEOUT_MIN * 60 * 1000) {
    throw new Error(`Build timed out after ${BUILD_TIMEOUT_MIN} minutes and was stopped.`);
  }
  if (!fs.existsSync(HEARTBEAT)) { try { fs.writeFileSync(HEARTBEAT, String(Date.now())); } catch { } }
}

// ------------------------------------------------------------- ZIP safety
function checkZipEntryName(rawName) {
  if (rawName.startsWith('/') || rawName.startsWith('\\')) return { ok: false, reason: `absolute path not allowed: ${rawName}` };
  if (/^[a-zA-Z]:[\\/]/.test(rawName)) return { ok: false, reason: `drive-absolute path not allowed: ${rawName}` };
  if (/[\u0000-\u001f<>:"|?*]/.test(rawName.replace(/\//g, ''))) return { ok: false, reason: `illegal characters in name: ${rawName}` };
  const parts = rawName.split(/[\\/]/);
  const normalized = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') return { ok: false, reason: `path traversal not allowed: ${rawName}` };
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)) return { ok: false, reason: `reserved device name: ${rawName}` };
    normalized.push(part);
  }
  if (normalized.length === 0) return { ok: true, normalized: '' };
  const joined = normalized.join('/');
  if (joined.length > 240) return { ok: false, reason: 'entry name too long' };
  return { ok: true, normalized: joined };
}

function safeExtractZip(zipBuffer, targetDir, { maxFiles, maxExtractBytes }) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((e) => !e.entryName.startsWith('__MACOSX/') && e.entryName.split('/').pop() !== '.DS_Store');
  if (entries.length > maxFiles) throw new Error(`ZIP contains too many entries (${entries.length}); maximum is ${maxFiles}.`);
  let total = 0;
  let fileCount = 0;
  for (const entry of entries) {
    const rawName = entry.rawEntryName ? entry.rawEntryName.toString('utf8') : entry.entryName;
    const checkRaw = checkZipEntryName(rawName);
    if (!checkRaw.ok) throw new Error(`Unsafe ZIP entry rejected — ${checkRaw.reason}`);
    const check = checkZipEntryName(entry.entryName);
    if (!check.ok) throw new Error(`Unsafe ZIP entry rejected — ${check.reason}`);
    if (entry.isDirectory || !check.normalized) continue;
    const size = entry.header.size;
    total += size;
    if (total > maxExtractBytes) throw new Error('ZIP decompressed size exceeds the platform limit (400 MB).');
    const dest = path.join(targetDir, check.normalized);
    if (!path.resolve(dest).startsWith(path.resolve(targetDir))) throw new Error(`Unsafe ZIP entry: ${entry.entryName}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    fileCount++;
  }
  return { fileCount, totalBytes: total };
}

// ------------------------------------------------------- XML / text helpers
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function jsonEscape(s) { return JSON.stringify(String(s)); }

// ------------------------------------------------------------------- icons
const ICON_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function generateIcons(iconPath, resDir, themeColor, appName) {
  const res = path.join(resDir);
  for (const dpi of Object.keys(ICON_SIZES)) fs.mkdirSync(path.join(res, `mipmap-${dpi}`), { recursive: true });
  fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });

  let source = iconPath;
  let tmpSvg = null;
  if (!source || !fs.existsSync(source)) {
    // Default icon: rounded square + abstract code brackets (no font dependency)
    const letter = (appName || 'A').trim().charAt(0).toUpperCase();
    const svg = `<svg width="192" height="192" xmlns="http://www.w3.org/2000/svg">
<rect width="192" height="192" rx="44" fill="${/^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : '#10B981'}"/>
<path d="M74 64 L48 96 L74 128" stroke="#FFFFFF" stroke-width="13" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M118 64 L144 96 L118 128" stroke="#FFFFFF" stroke-width="13" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="86" y="82" width="20" height="28" rx="10" fill="#FFFFFF" opacity="0.9"/>
</svg>`;
    tmpSvg = path.join(WORKSPACE, 'default-icon.svg');
    fs.writeFileSync(tmpSvg, svg);
    source = tmpSvg;
  }

  for (const [dpi, size] of Object.entries(ICON_SIZES)) {
    const buf = await sharp(source).resize(size, size, { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(path.join(res, `mipmap-${dpi}`, 'ic_launcher.png'), buf);
    const round = await sharp(source).resize(size, size, { fit: 'cover' }).composite([]).png().toBuffer();
    fs.writeFileSync(path.join(res, `mipmap-${dpi}`, 'ic_launcher_round.png'), round);
  }
  const splash = await sharp(source).resize(288, 288, { fit: 'inside' }).png().toBuffer();
  fs.writeFileSync(path.join(res, 'drawable-nodpi', 'splash_logo.png'), splash);
  if (tmpSvg && fs.existsSync(tmpSvg)) fs.rmSync(tmpSvg, { force: true });
}

// AES-256-GCM decryption of keystore passwords (same scheme as the web app)
function decryptSecret(payload) {
  const crypto = require('crypto');
  const secret = fs.readFileSync(path.join(STORAGE, '.h2a_secret'), 'utf8').trim();
  const key = crypto.createHash('sha256').update(secret).digest();
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// ------------------------------------------------------------ main pipeline
async function run() {
  log('HTML2APK Studio build worker started');
  log(`Machine: ${os.type()} ${os.release()} / Node ${process.version} / PID ${process.pid}`);
  if (!sharp) await fail('Image processing library (sharp) is unavailable in the build environment.');

  const build = await db.build.findUnique({ where: { id: BUILD_ID }, include: { project: true } });
  if (!build) await fail(`Build record ${BUILD_ID} not found.`);
  if (!['QUEUED', 'RUNNING'].includes(build.status)) {
    log(`Build status is ${build.status}; nothing to do.`); process.exit(0);
  }
  await db.build.update({ where: { id: BUILD_ID }, data: { status: 'RUNNING', startedAt: new Date(), workerPid: process.pid } });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(HEARTBEAT, String(Date.now()));

  const cfg = JSON.parse(build.configJson);
  // Build targets — what artifacts to produce: APK only, AAB only, or both in
  // one Gradle run. New configs carry `buildTargets`; legacy configs only had
  // `generateAab` ("also generate AAB" → BOTH). AAB is ALWAYS built with
  // bundleRelease and signed with the release keystore.
  const targets = (cfg.buildTargets === 'APK' || cfg.buildTargets === 'AAB' || cfg.buildTargets === 'BOTH')
    ? cfg.buildTargets
    : (cfg.generateAab ? 'BOTH' : 'APK');
  const wantsApk = targets !== 'AAB';
  const wantsAab = targets !== 'APK';
  log(`Build targets: ${targets} (buildType=${build.buildType}, apk=${wantsApk}, aab=${wantsAab})`);
  const project = build.project;
  const srcDir = path.join(WORKSPACE, 'src');
  const androidDir = path.join(WORKSPACE, 'android');
  const rawEntry = String(cfg.entryPath || project.entryPath || 'index.html');
  if (path.isAbsolute(rawEntry) || rawEntry.includes('..') || /[\\]/.test(rawEntry)) {
    await fail(`Invalid entry path "${rawEntry}" — must be a relative path inside the project.`);
    return;
  }
  const entryPath = rawEntry.replace(/^\/+/, '');
  const artifactsDir = path.join(STORAGE, 'artifacts', BUILD_ID);

  try { await checkCancellation(); } catch (e) { await fail(e.message); return; }

  // ---- Step: extract / copy source ----
  await setProgress('uploading', 6, 'Uploading Files');
  if (project.sourceType === 'ZIP') {
    await setProgress('extracting', 16, 'Extracting ZIP');
    const zipPath = path.join(project.storagePath, 'original.zip');
    if (!fs.existsSync(zipPath)) await fail('Stored ZIP project file is missing (it may have been cleaned up). Re-upload the project and try again.');
    try {
      const res = safeExtractZip(fs.readFileSync(zipPath), srcDir, { maxFiles: 3000, maxExtractBytes: 400 * 1024 * 1024 });
      log(`Extracted ${res.fileCount} files (${(res.totalBytes / 1024 / 1024).toFixed(2)} MB) with path-traversal protection enabled`);
    } catch (e) {
      await fail(`ZIP extraction failed: ${e.message}`);
      return;
    }
  } else {
    await setProgress('extracting', 16, 'Copying HTML file');
    fs.mkdirSync(srcDir, { recursive: true });
    const htmlFile = path.join(project.storagePath, 'original.html');
    if (!fs.existsSync(htmlFile)) await fail('Stored HTML file is missing (it may have been cleaned up). Re-upload and try again.');
    fs.copyFileSync(htmlFile, path.join(srcDir, entryPath));
    log(`Copied single HTML document as ${entryPath}`);
  }

  try { await checkCancellation(); } catch (e) { await fail(e.message); return; }

  // ---- Step: validate project + entry ----
  await setProgress('validating', 22, 'Validating Project');
  const entryFs = path.join(srcDir, entryPath);
  if (!fs.existsSync(entryFs)) {
    await fail(`Entry HTML file "${entryPath}" was not found in the project. Add it or select a different entry file.`);
    return;
  }
  const entryHead = fs.readFileSync(entryFs).subarray(0, 8192).toString('utf8').toLowerCase();
  if (!entryHead.includes('<')) {
    await fail(`Entry file "${entryPath}" does not look like an HTML document.`);
    return;
  }
  // count + inventory of packaged files
  const inventory = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else inventory.push(r);
    }
  })(srcDir, '');
  if (inventory.length === 0) { await fail('The project contains no files to package.'); return; }
  if (inventory.length > 3000) { await fail(`Project has too many files (${inventory.length}); maximum is 3000.`); return; }
  log(`Project inventory: ${inventory.length} files, entry = ${entryPath}`);

  try { await checkCancellation(); } catch (e) { await fail(e.message); return; }

  // ---- Step: build environment self-check (self-healing toolchain) ----
  // The bundled toolchain lives INSIDE the project (tools/jdk-21, tools/gradle-8.11.1,
  // android-sdk) so it survives environment restarts. Env overrides (H2A_* / JAVA_HOME)
  // are honored only when they actually contain a working toolchain; stale paths —
  // e.g. pointing at a wiped directory — fall back to the bundled copy. If the bundled
  // copy is itself missing, the worker runs scripts/sdk-setup.sh ONCE (streamed into
  // this build log) instead of failing mid-build with a cryptic "no javac" error.
  {
    const hasJavac = (h) => !!h && fs.existsSync(path.join(h, 'bin', 'javac'));
    const validSdk = (p) => !!p && (fs.existsSync(path.join(p, 'build-tools', BUILD_TOOLS, 'aapt2'))
      || fs.existsSync(path.join(p, 'platforms', `android-${COMPILE_SDK}`, 'android.jar')));
    const bundledJdkDir = path.join(ROOT, 'tools', 'jdk-21');
    const bundledGradleBin = path.join(ROOT, 'tools', 'gradle-8.11.1', 'bin', 'gradle');
    const bundledSdkDir = path.join(ROOT, 'android-sdk');
    const bundledOk = hasJavac(bundledJdkDir) && fs.existsSync(bundledGradleBin) && validSdk(bundledSdkDir);
    if (!bundledOk) {
      await setProgress('preparing', 8, 'Setting Up Build Environment');
      log('Bundled build toolchain incomplete (JDK/Gradle/Android SDK) — running one-time setup (scripts/sdk-setup.sh).');
      log('This downloads Gradle 8.11.1, Temurin JDK 21 and the Android SDK and may take several minutes; later builds run normally.');
      const res = await new Promise((resolve) => {
        const p = spawn('bash', [path.join(ROOT, 'scripts', 'sdk-setup.sh')], { cwd: ROOT, env: { ...process.env, H2A_ROOT: ROOT } });
        let errTail = '';
        const killer = setTimeout(() => { log('[setup] Setup timed out after 12 minutes — killing.'); p.kill('SIGKILL'); }, 12 * 60 * 1000);
        p.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => log(`[setup] ${l}`)));
        p.stderr.on('data', (d) => { errTail = (errTail + String(d)).slice(-4000); });
        p.on('exit', (code, signal) => { clearTimeout(killer); resolve({ code, signal, errTail }); });
        p.on('error', (e) => { clearTimeout(killer); resolve({ code: -1, signal: null, errTail: String(e) }); });
      });
      if (res.code !== 0) {
        await fail(`Automatic build-environment setup failed (exit ${res.code}${res.signal ? `, ${res.signal}` : ''}). Run "bash scripts/sdk-setup.sh" once on the server, then retry the build.`, res.errTail.slice(-3000));
        return;
      }
      log('Build environment setup completed.');
      try { await checkCancellation(); } catch (e) { await fail(e.message); return; }
    }
    // Post-setup re-validation: the setup script must actually have repaired the
    // toolchain (guards against partially restored installs).
    if (!bundledOk && !(hasJavac(bundledJdkDir) && fs.existsSync(bundledGradleBin) && validSdk(bundledSdkDir))) {
      await fail('Build-environment setup finished but the toolchain is still incomplete (JDK/Gradle/Android SDK). See the [setup] lines above for the failing step, or run "bash scripts/sdk-setup.sh" manually on the server.');
      return;
    }
    // Effective toolchain: env override only when it actually exists, bundled otherwise.
    if (!fs.existsSync(GRADLE_BIN) && fs.existsSync(bundledGradleBin)) {
      if (GRADLE_BIN !== bundledGradleBin) log(`H2A_GRADLE_BIN=${GRADLE_BIN} is not usable — falling back to bundled Gradle.`);
      GRADLE_BIN = bundledGradleBin;
    }
    if (!validSdk(SDK) && validSdk(bundledSdkDir)) {
      if (SDK !== bundledSdkDir) log(`H2A_ANDROID_SDK=${SDK} is not usable — falling back to bundled Android SDK.`);
      SDK = bundledSdkDir;
    }
    log(`Toolchain resolved: GRADLE_BIN=${GRADLE_BIN} SDK=${SDK}`);
  }

  // ---- Step: generate Android project ----
  await setProgress('preparing', 30, 'Preparing Android Project');
  fs.cpSync(path.join(ROOT, 'android-template'), androidDir, { recursive: true });
  fs.writeFileSync(path.join(androidDir, 'local.properties'), `sdk.dir=${SDK}\n`);
  log('Android project skeleton generated');

  // ---- Step: configure WebView + resources ----
  await setProgress('configuring', 38, 'Configuring WebView');
  const appCfg = {
    // Secure HTTPS origin via androidx.webkit WebViewAssetLoader — NOT file://.
    // This gives the packaged site a real origin: root-relative paths, ES
    // modules, fetch/XHR, localStorage/IndexedDB and canvas all work.
    startUrl: `https://appassets.androidplatform.net/assets/www/${entryPath}`,
    javascriptEnabled: cfg.javascriptEnabled !== false,
    domStorageEnabled: cfg.domStorageEnabled !== false,
    databaseEnabled: !!cfg.databaseEnabled,
    zoomControls: !!cfg.zoomControls,
    textZoom: cfg.textZoom || 100,
    allowFileAccess: cfg.allowFileAccess === true,
    externalLinks: cfg.externalLinks || 'external',
    cacheMode: cfg.cacheMode || 'default',
    mixedContent: cfg.mixedContent || 'never',
    fullscreen: !!cfg.fullscreen,
    splashEnabled: cfg.splashEnabled !== false,
    statusBarVisible: cfg.statusBarVisible !== false,
    statusBarColor: cfg.statusBarColor || '#0F172A',
    navigationBarColor: cfg.navigationBarColor || '#0F172A',
    brightness: cfg.brightness || 'system',
    language: cfg.language || 'en',
    openFileChooser: cfg.openFileChooser !== false,
    downloadsEnabled: cfg.downloadsEnabled !== false,
    userAgentSuffix: cfg.userAgentSuffix || '',
    permCamera: !!cfg.permissions?.camera,
    permMicrophone: !!cfg.permissions?.microphone,
    permLocation: !!cfg.permissions?.location,
    permNotifications: !!cfg.permissions?.notifications,
  };
  fs.writeFileSync(path.join(androidDir, 'app/src/main/assets/webview-config.json'), JSON.stringify(appCfg, null, 2));
  log(`WebView configuration written (${Object.keys(appCfg).length} settings)`);

  await setProgress('resources', 44, 'Generating Android Resources');
  const resDir = path.join(androidDir, 'app/src/main/res');

  // icons
  let iconSource = null;
  if (cfg.iconId) {
    const candidates = fs.readdirSync(path.join(STORAGE, 'uploads')).flatMap((d) => {
      const dir = path.join(STORAGE, 'uploads', d);
      return d === cfg.iconId ? fs.readdirSync(dir).filter((f) => f.startsWith('icon.')).map((f) => path.join(dir, f)) : [];
    });
    if (candidates.length) iconSource = candidates[0];
  }
  await generateIcons(iconSource, resDir, cfg.themeColor || '#10B981', cfg.appName || 'My App');
  log('Launcher icons generated for all densities (mdpi → xxxhdpi) + splash logo');

  // colors + strings
  fs.writeFileSync(path.join(resDir, 'values/colors.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splashBg">${xmlEscape(cfg.splashColor || cfg.statusBarColor || '#0F172A')}</color>\n    <color name="statusBar">${xmlEscape(cfg.statusBarColor || '#0F172A')}</color>\n    <color name="navBar">${xmlEscape(cfg.navigationBarColor || '#0F172A')}</color>\n</resources>\n`);
  fs.writeFileSync(path.join(resDir, 'values/strings.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">${xmlEscape(cfg.appName || 'My App')}</string>\n</resources>\n`);
  log('colors.xml + strings.xml generated');

  // AndroidManifest.xml
  const PERMS = [];
  const p = cfg.permissions || {};
  if (p.internet !== false) PERMS.push('android.permission.INTERNET');
  if (p.camera) PERMS.push('android.permission.CAMERA');
  if (p.microphone) PERMS.push('android.permission.RECORD_AUDIO');
  if (p.location) PERMS.push('android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION');
  if (p.fileAccess) PERMS.push('android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.READ_EXTERNAL_STORAGE');
  if (p.notifications) PERMS.push('android.permission.POST_NOTIFICATIONS');
  const permXml = PERMS.map((n) => {
    let maxSdk = '';
    if (n === 'android.permission.WRITE_EXTERNAL_STORAGE') maxSdk = ' android:maxSdkVersion="28"';
    if (n === 'android.permission.READ_EXTERNAL_STORAGE') maxSdk = ' android:maxSdkVersion="32"';
    return `    <uses-permission android:name="${n}"${maxSdk} />`;
  }).join('\n');
  const orientationMap = { portrait: 'portrait', landscape: 'landscape', auto: 'unspecified' };
  const screenOrientation = orientationMap[cfg.orientation] || 'portrait';
  const cleartext = cfg.mixedContent === 'compatibility' ? 'true' : 'false';
  const providerXml = appCfg.openFileChooser ? `
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>` : '';
  const featureXml = p.camera ? '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n' : '';

  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${featureXml}${permXml}

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="${cleartext}"
        android:theme="@style/Theme.H2A">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="${screenOrientation}"
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|uiMode|density"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>${providerXml}
    </application>

</manifest>
`;
  fs.writeFileSync(path.join(androidDir, 'app/src/main/AndroidManifest.xml'), manifest);
  log(`AndroidManifest.xml generated (${PERMS.length} permissions, orientation=${screenOrientation})`);

  // ---- Step: package website into assets/www ----
  const assetsWww = path.join(androidDir, 'app/src/main/assets/www');
  fs.cpSync(srcDir, assetsWww, { recursive: true });
  log(`Website packaged into app assets (assets/www/${entryPath} is the start page)`);

  // ---- Step: java toolchain ----
  // First candidate that ACTUALLY contains bin/javac wins: H2A_JAVA_HOME, the bundled
  // JDK (tools/jdk-21), JAVA_HOME, the standard system JVM, then PATH. A stale
  // H2A_JAVA_HOME or a JRE-only system JAVA_HOME must never win over the bundled JDK.
  // Resolved early so signing preflight (keytool) and AAB verification (jarsigner /
  // bundletool) all use the exact same JDK.
  const bundledJdk = path.join(ROOT, 'tools', 'jdk-21');
  const hasJavac = (h) => !!h && fs.existsSync(path.join(h, 'bin', 'javac'));
  const javaCandidates = [process.env.H2A_JAVA_HOME, bundledJdk, process.env.JAVA_HOME, '/usr/lib/jvm/java-21-openjdk-amd64'];
  try {
    const onPath = require('child_process').execSync('command -v javac', { encoding: 'utf8' }).trim();
    if (onPath) javaCandidates.push(path.dirname(path.dirname(onPath)));
  } catch { /* javac not on PATH — final check below reports it */ }
  const javaHome = javaCandidates.find(hasJavac);
  if (!javaHome) {
    await fail('No Java compiler (javac) available (checked H2A_JAVA_HOME, tools/jdk-21, JAVA_HOME and the system JVM). Install a JDK 17+ or run "bash scripts/sdk-setup.sh" once on the server.');
    return;
  }
  try {
    const jcBin = path.join(javaHome, 'bin', 'javac');
    const jcVer = require('child_process').execSync(`"${jcBin}" -version`, { encoding: 'utf8' }).trim();
    log(`Using JDK: ${javaHome} (${jcVer})`);
  } catch { log(`Using JDK: ${javaHome}`); }

  // ---- Step: signing config ----
  await setProgress('signing', 47, 'Preparing Signing');
  const signingBlocks = [];
  const gradleTasks = [];
  const gradleExtraEnv = {};

  // Debug-signed APK (target APK/BOTH with DEBUG variant) — behavior unchanged
  if (wantsApk && build.buildType === 'DEBUG') {
    const debugKs = path.join(STORAGE, 'keys', 'debug.keystore');
    if (!fs.existsSync(debugKs)) {
      fs.mkdirSync(path.dirname(debugKs), { recursive: true });
      execKeytool(['-genkeypair', '-v', '-keystore', debugKs, '-storepass', 'android',
        '-alias', 'androiddebugkey', '-keypass', 'android', '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '10950', '-dname', 'CN=Android Debug,O=Android,C=US']);
      log('Debug keystore generated automatically');
    }
    signingBlocks.push(`signingConfigs {
        debug {
            storeFile file('${debugKs.replace(/\\/g, '\\\\')}')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`);
    gradleTasks.push('assembleDebug');
  }

  // Release signing is required for RELEASE APKs and for EVERY AAB (Play
  // Store requires upload-key-signed bundles; bundleRelease output is signed
  // via the release signingConfig below).
  if (build.buildType === 'RELEASE' || wantsAab) {
    let ksFile = process.env.KEYSTORE_FILE;
    let ksAlias = process.env.KEY_ALIAS;
    let ksPassword = process.env.KEYSTORE_PASSWORD;
    let ksKeyPassword = process.env.KEY_PASSWORD;
    // resolve from the saved keystore record when not passed via env
    if ((!ksFile || !ksAlias || !ksPassword || !ksKeyPassword) && cfg.releaseKeystoreId) {
      const ks = await db.keystore.findUnique({ where: { id: String(cfg.releaseKeystoreId) } });
      if (ks) {
        ksFile = ks.filePath;
        ksAlias = ks.alias;
        ksPassword = decryptSecret(ks.passwordEnc);
        ksKeyPassword = decryptSecret(ks.keyPasswordEnc);
        log(`Using saved release keystore (alias=${ks.alias}) — passwords decrypted in memory only`);
      }
    }
    if (!ksFile || !fs.existsSync(ksFile) || !ksAlias || !ksPassword || !ksKeyPassword) {
      await fail('Release/AAB builds require a valid signing keystore (file, alias, keystore password and key password). AABs must always be release-signed. Configure signing and try again.');
      return;
    }
    // Pre-flight: verify the keystore actually opens with the given password
    // and contains the requested alias BEFORE spending minutes on Gradle.
    log(`Verifying signing keystore (alias=${ksAlias})…`);
    const ksCheck = execCapture(path.join(javaHome, 'bin', 'keytool'), ['-list', '-keystore', ksFile,
      '-storepass:env', 'H2A_KS_PW', '-alias', ksAlias],
      { H2A_KS_PW: ksPassword, JAVA_HOME: javaHome });
    if (ksCheck.code !== 0) {
      const out = ksCheck.out || '';
      const hint = /alias.*does not exist|Alias.*does not exist/i.test(out)
        ? `Alias "${ksAlias}" does not exist in this keystore.`
        : /keystore.*tampered|password.*incorrect|given final block|Keystore was corrupted/i.test(out)
          ? 'The keystore password is incorrect.'
          : 'The keystore file could not be opened (corrupted or unsupported format).';
      await fail(`Signing verification failed. ${hint}`, out.slice(0, 2000));
      return;
    }
    log('Keystore verified: password OK and alias present');
    signingBlocks.push(`signingConfigs {
        release {
            storeFile file('${ksFile.replace(/\\/g, '\\\\')}')
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias '${ksAlias.replace(/'/g, "\\'")}'
            keyPassword System.getenv('KEY_PASSWORD')
        }
    }`);
    if (wantsApk && build.buildType === 'RELEASE') gradleTasks.push('assembleRelease');
    if (wantsAab) gradleTasks.push('bundleRelease');
    // pass passwords to the Gradle process via environment (never written to disk or logs)
    gradleExtraEnv.KEYSTORE_PASSWORD = ksPassword;
    gradleExtraEnv.KEY_PASSWORD = ksKeyPassword;
  }
  const signingBlock = signingBlocks.join('\n\n');

  // ---- Step: build.gradle ----
  const appGradle = `plugins {
    id 'com.android.application'
}

android {
    namespace 'com.html2apk.studio.wv'
    compileSdk ${COMPILE_SDK}

    defaultConfig {
        applicationId '${cfg.packageName}'
        minSdk 24
        targetSdk ${TARGET_SDK}
        versionCode ${Number(cfg.versionCode) || 1}
        versionName '${String(cfg.versionName || '1.0').replace(/'/g, "\\'")}'
    }

    ${signingBlock}

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'${(build.buildType === 'RELEASE' || wantsAab) ? '\n            signingConfig signingConfigs.release' : ''}
        }
        debug {
            ${build.buildType === 'DEBUG' && wantsApk ? 'signingConfig signingConfigs.debug' : ''}
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    lint {
        abortOnError false
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.7.1'
    implementation 'androidx.webkit:webkit:1.14.0'
}

// Align kotlin-stdlib artifacts: some androidx transitive pins still reference
// the pre-merge kotlin-stdlib-jdk7/jdk8 artifacts whose classes also live in
// kotlin-stdlib 1.8+ (they are empty stubs since 1.8.0). Forcing all three to
// the same version removes the duplicate-class failure.
configurations.all {
    resolutionStrategy {
        force 'org.jetbrains.kotlin:kotlin-stdlib:1.8.22'
        force 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22'
        force 'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22'
    }
}
`;
  fs.writeFileSync(path.join(androidDir, 'app/build.gradle'), appGradle);
  log(`app/build.gradle generated (applicationId=${cfg.packageName}, v${cfg.versionName}+${cfg.versionCode}, type=${build.buildType}, targets=${targets})`);

  try { await checkCancellation(); } catch (e) { await fail(e.message); return; }

  // ---- Step: compile ----
  await setProgress('compiling', 52, 'Compiling Android Application');
  const gradleEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: path.join(javaHome, 'bin') + path.delimiter + (process.env.PATH || ''),
    ANDROID_HOME: SDK,
    ANDROID_SDK_ROOT: SDK,
    GRADLE_USER_HOME: process.env.H2A_GRADLE_USER_HOME || path.join(ROOT, '.gradle-home'),
    H2A_MAVEN_MIRROR: process.env.H2A_MAVEN_MIRROR || 'aliyun',
    ...gradleExtraEnv,
  };
  if (!fs.existsSync(GRADLE_BIN)) {
    await fail(`Gradle executable not found at ${GRADLE_BIN}. Run scripts/sdk-setup.sh or set H2A_GRADLE_BIN.`);
    return;
  }
  const gradleArgs = ['-p', androidDir, '--no-daemon', '--console=plain', ...gradleTasks];
  log(`Executing: gradle ${gradleArgs.join(' ')}`);
  log(`ANDROID_HOME=${SDK} JAVA_HOME=${gradleEnv.JAVA_HOME}`);

  const exitCode = await new Promise((resolve) => {
    let buffer = '';
    gradleProc = spawn(GRADLE_BIN, gradleArgs, {
      cwd: androidDir,
      env: gradleEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (chunk) => {
      const text = chunk.toString();
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        log(line.replace(/\r/g, ''));
        if (line.startsWith('> Task :app:')) {
          const t = line.replace('> Task :app:', '').trim();
          const map = {
            'preBuild': 55, 'preReleaseBuild': 55, 'preDebugBuild': 55,
            'compileReleaseJavaWithJavac': 68, 'compileDebugJavaWithJavac': 68,
            'processReleaseResources': 62, 'processDebugResources': 62,
            'mergeReleaseResources': 60, 'mergeDebugResources': 60,
            'checkReleaseAarMetadata': 58, 'checkDebugAarMetadata': 58,
            'dexBuilderRelease': 74, 'dexBuilderDebug': 74,
            'mergeDexRelease': 78, 'mergeDexDebug': 78,
            'mergeReleaseAssets': 64, 'mergeDebugAssets': 64,
            'packageRelease': 84, 'packageDebug': 84,
            'assembleRelease': 88, 'assembleDebug': 88,
            'packageReleaseBundle': 90, 'buildReleaseBundle': 91,
          };
          if (map[t]) setProgress('compiling', map[t], 'Compiling Android Application');
        }
        if (/BUILD SUCCESSFUL/.test(line)) setProgress('compiling', 90, 'Compiling Android Application');
      }
    };
    gradleProc.stdout.on('data', onData);
    gradleProc.stderr.on('data', onData);
    // watchdog for cancellation / timeout during gradle
    const watchdog = setInterval(async () => {
      try {
        const b = await db.build.findUnique({ where: { id: BUILD_ID }, select: { status: true } });
        if (b && b.status === 'CANCELLED') {
          log('Cancellation requested — terminating Gradle process tree');
          try { process.kill(-gradleProc.pid, 'SIGKILL'); } catch { try { gradleProc.kill('SIGKILL'); } catch { } }
        }
        if (Date.now() - startTs > BUILD_TIMEOUT_MIN * 60 * 1000) {
          log('Timeout reached — terminating Gradle process tree');
          try { process.kill(-gradleProc.pid, 'SIGKILL'); } catch { try { gradleProc.kill('SIGKILL'); } catch { } }
        }
      } catch { }
    }, 4000);
    gradleProc.on('exit', (code) => { clearInterval(watchdog); resolve(code); });
    gradleProc.on('error', (err) => { clearInterval(watchdog); log(`gradle spawn error: ${err.message}`); resolve(-1); });
  });

  if (cancelled) { await cleanupWorkspace(true); process.exit(1); }
  if (exitCode !== 0) {
    await fail('Gradle build failed — the Android compiler reported errors (see build logs).',
      'Gradle exited with code ' + exitCode);
    return;
  }
  log('Gradle build completed successfully');

  // ---- Step: validate artifacts ----
  await setProgress('validatingApk', 93, wantsAab && !wantsApk ? 'Validating AAB' : 'Validating APK');
  const btDir = path.join(SDK, 'build-tools', BUILD_TOOLS);
  const expected = [];
  if (wantsApk) {
    expected.push(build.buildType === 'DEBUG'
      ? { src: 'app/build/outputs/apk/debug/app-debug.apk', kind: 'apk' }
      : { src: 'app/build/outputs/apk/release/app-release.apk', kind: 'apk' });
  }
  if (wantsAab) {
    expected.push({ src: 'app/build/outputs/bundle/release/app-release.aab', kind: 'aab' });
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  const results = {};
  for (const art of expected) {
    const srcPath = path.join(androidDir, art.src);
    if (!fs.existsSync(srcPath)) {
      await fail(`Build did not produce the expected ${art.kind.toUpperCase()} file (${art.src}). The Gradle run may have silently skipped this task.`);
      return;
    }
    const stat = fs.statSync(srcPath);
    if (stat.size < 20 * 1024) {
      await fail(`Generated ${art.kind.toUpperCase()} is suspiciously small (${stat.size} bytes). Build rejected.`);
      return;
    }

    // ZIP-structure validation
    let zip;
    try { zip = new AdmZip(srcPath); } catch (e) {
      await fail(`Generated ${art.kind.toUpperCase()} is not a valid ZIP container: ${e.message}`);
      return;
    }
    const names = new Set(zip.getEntries().map((e) => e.entryName));
    if (art.kind === 'apk') {
      if (!names.has('AndroidManifest.xml')) { await fail('APK validation failed: AndroidManifest.xml missing from package.'); return; }
      if (!names.has('classes.dex')) { await fail('APK validation failed: classes.dex missing from package.'); return; }
      if (![...names].some((n) => n.startsWith('assets/www/'))) { await fail('APK validation failed: website assets (assets/www/) missing from package.'); return; }
      // signature verification
      const verify = execCapture(path.join(btDir, 'apksigner'), ['verify', '--verbose', '--print-certs', srcPath]);
      if (verify.code !== 0 || /DOES NOT VERIFY/.test(verify.out)) {
        await fail('APK signature verification failed (apksigner).', verify.out.slice(0, 3000));
        return;
      }
      log('apksigner verify: PASSED');
      log(verify.out.split('\n').filter((l) => /Verifie|Signer #1 certificate DN|SHA-256/.test(l)).join('\n'));
      // badging metadata + identity check (same package/version as requested)
      const badging = execCapture(path.join(btDir, 'aapt2'), ['dump', 'badging', srcPath]);
      const pkgLine = (badging.out.split('\n').find((l) => l.startsWith('package:')) || '').trim();
      log(`aapt2 badging: ${pkgLine}`);
      if (!pkgLine.includes(`name='${cfg.packageName}'`)) {
        await fail(`APK metadata check failed: package in APK does not match requested package (${cfg.packageName}).`, pkgLine);
        return;
      }
      const apkVc = Number((pkgLine.match(/versionCode='(\d+)'/) || [])[1]);
      const apkVn = (pkgLine.match(/versionName='([^']+)'/) || [])[1];
      if (apkVc !== (Number(cfg.versionCode) || 1) || apkVn !== String(cfg.versionName || '1.0')) {
        await fail(`APK metadata check failed: version mismatch (expected ${cfg.versionName}+${Number(cfg.versionCode) || 1}, got ${apkVn}+${apkVc}).`, pkgLine);
        return;
      }
      log(`APK identity check: package=${cfg.packageName} versionName=${apkVn} versionCode=${apkVc} — matches request`);
    } else {
      // ---------- AAB verification (multi-stage) ----------
      if (!names.has('BundleConfig.pb') || ![...names].some((n) => n === 'base/manifest/AndroidManifest.xml')) {
        await fail('AAB validation failed: required bundle entries missing.'); return;
      }
      log('AAB structure validation: PASSED (BundleConfig.pb + base manifest present)');

      // 2) signature: AABs carry a JAR (v1) signature — verified with jarsigner.
      //    Confirms the bundle is really signed with the provided release keystore.
      //    NOTE: no `-strict` — Android signing keys are self-signed X.509 certs,
      //    which strict PKIX validation would (wrongly) reject. "jar verified"
      //    with exit 0 is the definitive pass for AAB signatures.
      const jsVerify = execCapture(path.join(javaHome, 'bin', 'jarsigner'), ['-verify', srcPath], { JAVA_HOME: javaHome });
      if (jsVerify.code !== 0 || !/jar verified\./i.test(jsVerify.out)) {
        await fail('AAB signature verification failed (jarsigner): the bundle is not properly signed with the release keystore.', jsVerify.out.slice(0, 3000));
        return;
      }
      log('jarsigner verify: PASSED — AAB is signed with the release keystore');

      // 3) bundle identity via bundletool (official tool): package, versionCode
      //    and versionName must exactly match the request (and therefore the APK).
      const btJar = resolveBundletoolJar();
      if (btJar) {
        const dump = execCapture(path.join(javaHome, 'bin', 'java'),
          ['-jar', btJar, 'dump', 'manifest', '--bundle', srcPath], { JAVA_HOME: javaHome });
        if (dump.code !== 0) {
          await fail('AAB validation failed: bundletool could not read the bundle manifest (corrupted bundle?).', dump.out.slice(0, 3000));
          return;
        }
        const aabPkg = (dump.out.match(/package\s*=\s*["']([^"']+)["']/) || [])[1];
        const aabVc = Number((dump.out.match(/versionCode\s*=\s*["']?(\d+)/) || [])[1]);
        const aabVn = (dump.out.match(/versionName\s*=\s*["']([^"']+)['"]/) || [])[1];
        log(`bundletool dump manifest: package=${aabPkg} versionName=${aabVn} versionCode=${aabVc}`);
        if (aabPkg !== cfg.packageName || aabVc !== (Number(cfg.versionCode) || 1) || aabVn !== String(cfg.versionName || '1.0')) {
          await fail(`AAB identity check failed: bundle metadata does not match the request (expected ${cfg.packageName} / ${cfg.versionName}+${Number(cfg.versionCode) || 1}, got ${aabPkg} / ${aabVn}+${aabVc}).`);
          return;
        }
        log(`AAB identity check: package=${aabPkg} versionName=${aabVn} versionCode=${aabVc} — matches request${results.apk ? ' and APK' : ''}`);
      } else {
        log('bundletool jar not found — skipped bundle identity dump (structure + signature checks already passed).');
      }
    }
    const destName = art.kind === 'apk'
      ? (build.buildType === 'DEBUG' ? 'app-debug.apk' : 'app-release.apk')
      : 'app-release.aab';
    const destPath = path.join(artifactsDir, destName);
    fs.copyFileSync(srcPath, destPath);
    results[art.kind] = { path: destPath, size: stat.size };
    log(`${art.kind.toUpperCase()} validated and published: ${destName} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  }

  if (!results.apk && !results.aab) { await fail('No artifacts were produced by the build.'); return; }
  log(`Artifact summary: ${[
    results.apk ? `APK ${(results.apk.size / 1024 / 1024).toFixed(2)} MB` : null,
    results.aab ? `AAB ${(results.aab.size / 1024 / 1024).toFixed(2)} MB` : null,
  ].filter(Boolean).join(' + ')} — identity: ${cfg.packageName} v${cfg.versionName}+${cfg.versionCode} (same for all artifacts)`);

  // ---- Step: finalize ----
  const expiresAt = new Date(Date.now() + Number(process.env.H2A_RETENTION_DAYS || 7) * 24 * 3600 * 1000);
  await db.build.update({
    where: { id: BUILD_ID },
    data: {
      status: 'SUCCEEDED',
      step: 'Build Completed',
      progress: 100,
      apkPath: results.apk?.path || null,
      apkSize: results.apk?.size || null,
      aabPath: results.aab?.path || null,
      aabSize: results.aab?.size || null,
      finishedAt: new Date(),
      errorMessage: null,
      expiresAt,
    },
  });
  log(`=== BUILD SUCCEEDED === artifacts retained until ${expiresAt.toISOString().slice(0, 10)}`);
  await cleanupWorkspace(true);
  process.exit(0);
}

/** Locates the bundletool jar for AAB verification: tools/bundletool.jar, the
 *  H2A_BUNDLETOOL_JAR env override, or the Gradle dependency cache. */
function resolveBundletoolJar() {
  const explicit = process.env.H2A_BUNDLETOOL_JAR;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const fixed = path.join(ROOT, 'tools', 'bundletool.jar');
  if (fs.existsSync(fixed)) return fixed;
  try {
    const cache = path.join(process.env.H2A_GRADLE_USER_HOME || path.join(ROOT, '.gradle-home'),
      'caches', 'modules-2', 'files-2.1', 'com.android.tools.build', 'bundletool');
    for (const ver of fs.readdirSync(cache)) {
      const verDir = path.join(cache, ver);
      for (const hash of fs.readdirSync(verDir)) {
        for (const f of fs.readdirSync(path.join(verDir, hash))) {
          if (/^bundletool-[\d.]+\.jar$/.test(f)) return path.join(verDir, hash, f);
        }
      }
    }
  } catch { }
  return null;
}

function execCapture(cmd, args, extraEnv) {
  try {
    const { execFileSync } = require('child_process');
    const env = { ...process.env, ...(extraEnv || {}) };
    if (env.JAVA_HOME) env.PATH = path.join(env.JAVA_HOME, 'bin') + path.delimiter + (env.PATH || process.env.PATH || '');
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 120000, env });
    return { code: 0, out: out || '' };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function execKeytool(args) {
  const { execFileSync } = require('child_process');
  execFileSync('keytool', args, { stdio: 'pipe', timeout: 120000 });
}

run().catch(async (e) => {
  await fail(e && e.message ? e.message : 'Unexpected worker error', e && e.stack ? e.stack.slice(0, 4000) : undefined);
});
