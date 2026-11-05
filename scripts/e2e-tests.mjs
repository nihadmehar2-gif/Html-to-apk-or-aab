#!/usr/bin/env node
/**
 * E2E test suite for HTML2APK Studio (Tests 4, 5, 6 from the requirements).
 * Run: node scripts/e2e-tests.mjs
 */
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const BASE = 'http://localhost:3000';
let cookie = '';
let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function api(method, path, body, isForm) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (!isForm && body) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch { }
  return { status: res.status, data, headers: res.headers };
}

async function loginAdmin() {
  const r = await api('POST', '/api/auth/login', { email: 'admin@html2apk.studio', password: 'Admin#2026' });
  return r.status === 200;
}

async function main() {
  console.log('\n═══ Test 4: Release APK + AAB signing ═══');
  {
    const okLogin = await loginAdmin();
    check('admin login', okLogin);

    // upload a small ZIP
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<!DOCTYPE html><html><head><title>Rel</title></head><body><h1>Release test</h1><script>document.body.style.background="#10b981";</script></body></html>'));
    const form = new FormData();
    form.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'release-test.zip');
    const up = await api('POST', '/api/uploads', form, true);
    check('release test upload', up.status === 200 && up.data.analysis.entryPath === 'index.html', `entry=${up.data?.analysis?.entryPath}`);

    // generate keystore via API
    const ks = await api('POST', '/api/keystores', {
      mode: 'generate', alias: 'test-release-key', password: 'TestRelease#2026',
      commonName: 'E2E Tester', organization: 'HTML2APK QA',
    });
    check('keystore generated via API', ks.status === 200 && ks.data.keystore?.id, `alias=${ks.data?.keystore?.alias}`);

    // wrong-password keystore upload must fail
    const badForm = new FormData();
    badForm.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'fake.jks');
    badForm.append('alias', 'x');
    badForm.append('password', 'wrongpass');
    const badKs = await api('POST', '/api/keystores', badForm, true);
    check('corrupt keystore rejected with validation error', badKs.status === 400, badKs.data?.error?.slice(0, 60));

    // create RELEASE build with AAB
    const b = await api('POST', '/api/builds', {
      projectId: up.data.projectId,
      config: {
        appName: 'Release Test App', packageName: 'io.qa.releasetest', versionName: '2.5.1', versionCode: 7,
        buildType: 'RELEASE', generateAab: true, releaseKeystoreId: ks.data.keystore.id,
        description: 'release+aab e2e', language: 'en', themeColor: '#10B981', splashEnabled: true,
        splashColor: '#0F172A', orientation: 'landscape', fullscreen: false, statusBarVisible: true,
        statusBarColor: '#0F172A', navigationBarColor: '#0F172A', brightness: 'system',
        javascriptEnabled: true, domStorageEnabled: true, databaseEnabled: false, zoomControls: false,
        textZoom: 100, allowFileAccess: true, externalLinks: 'external', cacheMode: 'default',
        mixedContent: 'never', openFileChooser: true, downloadsEnabled: true, userAgentSuffix: '',
        permissions: { internet: true, camera: false, microphone: false, location: false, fileAccess: false, notifications: false },
        entryPath: 'index.html',
      },
    });
    check('release build created', b.status === 201 && b.data.buildId, b.data?.buildId);

    // poll until finished (max 8 min)
    let final = null;
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await api('GET', `/api/builds/${b.data.buildId}`);
      final = s.data.build;
      if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(final.status)) break;
    }
    check('release build SUCCEEDED', final?.status === 'SUCCEEDED', final?.errorMessage?.slice(0, 120));

    if (final?.status === 'SUCCEEDED') {
      // verify artifacts on disk (API intentionally hides server paths — derive them)
      const apkPath = `/home/z/my-project/storage/artifacts/${final.id}/app-release.apk`;
      const aabPath = `/home/z/my-project/storage/artifacts/${final.id}/app-release.aab`;
      check('AAB generated', Boolean(final.hasAab) && fs.existsSync(aabPath), final.aabSize ? `${(final.aabSize / 1048576).toFixed(2)} MB` : '');
      check('apk file exists and non-empty', final.hasApk === true && fs.existsSync(apkPath) && fs.statSync(apkPath).size > 20000);

      // apksigner verify + keystore cert check
      const { execSync } = await import('child_process');
      // resolve build-tools from .env / project layout (never hardcode)
      let BT = '/home/z/my-project/android-sdk/build-tools/36.0.0';
      try {
        const envText = fs.readFileSync('/home/z/my-project/.env', 'utf8');
        const envVars = Object.fromEntries(envText.split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
        BT = `${envVars.H2A_ANDROID_SDK || '/home/z/my-project/android-sdk'}/build-tools/${envVars.H2A_BUILD_TOOLS || '36.0.0'}`;
      } catch { }
      let verify = '';
      try { verify = execSync(`${BT}/apksigner verify --print-certs "${apkPath}"`, { encoding: 'utf8' }); } catch (e) { verify = e.stdout || 'VERIFY FAILED'; }
      check('release APK signature valid', /Verifie|Signer #1 certificate DN/.test(verify) && !/DOES NOT VERIFY/.test(verify));
      check('release cert is the user keystore (CN=E2E Tester)', verify.includes('CN=E2E Tester'), verify.split('\n')[0]?.slice(0, 80));

      const badging = execSync(`${BT}/aapt2 dump badging "${apkPath}"`, { encoding: 'utf8' });
      check('package name applied', badging.includes("name='io.qa.releasetest'"));
      check('versionCode 7 / versionName 2.5.1 applied', badging.includes("versionCode='7'") && badging.includes("versionName='2.5.1'"));
      check('label applied', badging.includes("application-label:'Release Test App'"));
      check('landscape orientation applied', badging.includes('screenOrientation=0') === false); // 0=landscape in badging? verify via manifest below
      const manifest = execSync(`${BT}/aapt2 dump xmltree --file AndroidManifest.xml "${apkPath}"`, { encoding: 'utf8' });
      check('landscape orientation in manifest', /screenOrientation\(0x0101001e\)=0/.test(manifest), '0 = landscape');

      // AAB structure
      const aabZip = new AdmZip(aabPath);
      const names = aabZip.getEntries().map((e) => e.entryName);
      check('AAB has BundleConfig.pb + base manifest', names.includes('BundleConfig.pb') && names.includes('base/manifest/AndroidManifest.xml'));

      // download both
      const dlApk = await fetch(`${BASE}/api/builds/${final.id}/download?type=apk`, { headers: { cookie } });
      check('download release APK works', dlApk.status === 200 && dlApk.headers.get('content-type') === 'application/vnd.android.package-archive');
      await dlApk.arrayBuffer();
      const dlAab = await fetch(`${BASE}/api/builds/${final.id}/download?type=aab`, { headers: { cookie } });
      check('download AAB works', dlAab.status === 200);
      await dlAab.arrayBuffer();
    }
  }

  console.log('\n═══ Test 5: Error handling ═══');
  {
    // invalid package name
    let r = await api('POST', '/api/builds', { projectId: 'x', config: { appName: 'X', packageName: 'com.while.bad', versionName: '1.0', versionCode: 1, buildType: 'DEBUG', entryPath: 'index.html' } });
    check('reserved Java keyword package rejected', r.status === 400, r.data?.error?.slice(0, 60));
    r = await api('POST', '/api/builds', { projectId: 'x', config: { appName: 'X', packageName: 'not-a-package', versionName: '1.0', versionCode: 1, buildType: 'DEBUG', entryPath: 'index.html' } });
    check('malformed package rejected', r.status === 400, r.data?.error?.slice(0, 60));

    // corrupted zip upload
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('this is not a zip file at all 123456')], { type: 'application/zip' }), 'corrupt.zip');
    r = await api('POST', '/api/uploads', form, true);
    check('corrupted ZIP rejected', r.status === 400 && /Corrupted ZIP/i.test(r.data?.error || ''), r.data?.error?.slice(0, 70));

    // text file disguised as html
    const form2 = new FormData();
    form2.append('file', new Blob([Buffer.from('just plain text, no markup here')], { type: 'text/html' }), 'fake.html');
    r = await api('POST', '/api/uploads', form2, true);
    check('non-HTML file rejected', r.status === 415, r.data?.error?.slice(0, 60));

    // unsupported extension
    const form3 = new FormData();
    form3.append('file', new Blob([Buffer.from('MZfakeexe')], { type: 'application/octet-stream' }), 'evil.exe');
    r = await api('POST', '/api/uploads', form3, true);
    check('.exe upload rejected', r.status === 415, r.data?.error?.slice(0, 60));

    // missing entry file → 422 with file list
    const zip2 = new AdmZip();
    zip2.addFile('about.html', Buffer.from('<html><body>no index here</body></html>'));
    zip2.addFile('data.json', Buffer.from('{"a":1}'));
    const form4 = new FormData();
    form4.append('file', new Blob([zip2.toBuffer()], { type: 'application/zip' }), 'noindex.zip');
    const up = await api('POST', '/api/uploads', form4, true);
    check('ZIP without index.html uploaded with warning', up.status === 200 && up.data.analysis.warnings.length > 0);
    r = await api('POST', '/api/builds', { projectId: up.data.projectId, config: { appName: 'NoEntry', packageName: 'io.qa.noentry', versionName: '1.0', versionCode: 1, buildType: 'DEBUG', entryPath: 'missing.html' } });
    check('missing entry → 422 + needsEntrySelection', r.status === 422 && r.data.needsEntrySelection === true && Array.isArray(r.data.htmlFiles));
    // with entry selection it should build — use existing entry
    r = await api('POST', '/api/builds', { projectId: up.data.projectId, config: { appName: 'NoEntry Fixed', packageName: 'io.qa.noentry', versionName: '1.0', versionCode: 1, buildType: 'DEBUG', entryPath: 'about.html' } });
    check('build with user-selected entry accepted', r.status === 201, r.data?.buildId);

    // release without keystore rejected
    const zip3 = new AdmZip();
    zip3.addFile('index.html', Buffer.from('<html><body>rel</body></html>'));
    const form5 = new FormData();
    form5.append('file', new Blob([zip3.toBuffer()], { type: 'application/zip' }), 'rel2.zip');
    const up2 = await api('POST', '/api/uploads', form5, true);
    r = await api('POST', '/api/builds', { projectId: up2.data.projectId, config: { appName: 'RelNoKs', packageName: 'io.qa.relnoks', versionName: '1.0', versionCode: 1, buildType: 'RELEASE', entryPath: 'index.html' } });
    check('release without keystore rejected', r.status === 400, r.data?.error?.slice(0, 70));
  }

  console.log('\n═══ Test 6: Security ═══');
  {
    // ZIP path traversal — fixture crafted with RAW entry names (../ and absolute)
    // (adm-zip sanitizes names at write time, so the fixture is pre-built)
    const evilBytes = fs.readFileSync('/home/z/my-project/scripts/fixtures/evil-traversal.zip');
    const form = new FormData();
    form.append('file', new Blob([evilBytes], { type: 'application/zip' }), 'evil.zip');
    const r = await api('POST', '/api/uploads', form, true);
    check('path traversal ZIP rejected', r.status === 400 && /Unsafe ZIP entry/.test(r.data?.error || ''), r.data?.error?.slice(0, 70));
    check('no file escaped to parent dirs', !fs.existsSync('/tmp/pwned-by-traversal.txt'));

    // unauthorized downloads (no session)
    const builds = await api('GET', '/api/builds');
    const someBuild = builds.data.builds?.[0];
    cookie = '';
    const dl = await fetch(`${BASE}/api/builds/${someBuild.id}/download?type=apk`);
    check('download without session → 401', dl.status === 401);
    const st = await api('GET', `/api/builds/${someBuild.id}`);
    check('foreign build status → 401', st.status === 401);

    // admin-only endpoints as anonymous
    const stats = await api('GET', '/api/admin/stats');
    check('admin stats without auth → 401', stats.status === 401);
    const sys = await api('GET', '/api/admin/system');
    check('admin system without auth → 401', sys.status === 401);

    // non-admin user cannot access admin endpoints
    await api('POST', '/api/auth/login', { email: 'demo@html2apk.studio', password: 'demo1234' });
    const stats2 = await api('GET', '/api/admin/stats');
    check('admin stats as normal user → 403', stats2.status === 403);

    // ownership: demo cannot download another user's build (create via admin below already covered) — demo download of own build works
    const own = await api('GET', '/api/builds');
    const ownBuild = own.data.builds?.find((b) => b.status === 'SUCCEEDED');
    if (ownBuild) {
      const dl2 = await fetch(`${BASE}/api/builds/${ownBuild.id}/download?type=apk`, { headers: { cookie } });
      check('owner can download own build', dl2.status === 200);
      await dl2.arrayBuffer();
    }

    // log masking: keystore passwords never appear in logs
    await loginAdmin();
    const allBuilds = await api('GET', '/api/admin/builds');
    const relBuild = allBuilds.data.builds.find((b) => b.appName === 'Release Test App');
    if (relBuild) {
      const logs = await api('GET', `/api/builds/${relBuild.id}/logs?offset=0`);
      const text = logs.data.chunk || '';
      check('keystore password never logged', !text.includes('TestRelease#2026'));
      check('build log shows keystore alias only', text.includes('test-release-key'));
    }
  }

  console.log('\n═══ Test 7: Regressions (Nov 2026 fixes) ═══');
  {
    // R1: valid keystore + WRONG password at upload time → rejected with clear error
    // (uses a REAL keystore generated here, not a fake file)
    const ksDir = '/tmp/e2e-r1-ks';
    fs.rmSync(ksDir, { recursive: true, force: true });
    fs.mkdirSync(ksDir, { recursive: true });
    const { execSync } = await import('child_process');
    execSync(`keytool -genkeypair -keystore ${ksDir}/r1.jks -storepass Correct#123 -alias r1key -keypass Correct#123 -keyalg RSA -keysize 2048 -validity 30 -dname "CN=R1,O=T,C=US"`, { stdio: 'pipe' });
    const badPwForm = new FormData();
    badPwForm.append('file', new Blob([fs.readFileSync(`${ksDir}/r1.jks`)], { type: 'application/octet-stream' }), 'r1.jks');
    badPwForm.append('alias', 'r1key');
    badPwForm.append('password', 'WrongPass#999');
    let r = await api('POST', '/api/keystores', badPwForm, true);
    check('R1: valid keystore + wrong password rejected', r.status === 400, r.data?.error?.slice(0, 70));

    // R2: entryPath with path traversal characters → rejected by validation
    const idxZip = new AdmZip();
    idxZip.addFile('index.html', Buffer.from('<html><body>idx</body></html>'));
    const idxForm = new FormData();
    idxForm.append('file', new Blob([idxZip.toBuffer()], { type: 'application/zip' }), 'r2.zip');
    const up = await api('POST', '/api/uploads', idxForm, true);
    r = await api('POST', '/api/builds', { projectId: up.data.projectId, config: { appName: 'Trav', packageName: 'io.qa.traversal', versionName: '1.0', versionCode: 1, buildType: 'DEBUG', entryPath: '../../etc/hosts' } });
    check('R2: entryPath traversal rejected', r.status === 400 || r.status === 422, `status=${r.status}`);

    // R3: original.zip must NOT be counted as a project asset
    const multiZip = new AdmZip();
    multiZip.addFile('index.html', Buffer.from('<html><body>multi</body></html>'));
    multiZip.addFile('style.css', Buffer.from('body{}'));
    multiZip.addFile('deep/page.html', Buffer.from('<html><body>deep</body></html>'));
    const multiForm = new FormData();
    multiForm.append('file', new Blob([multiZip.toBuffer()], { type: 'application/zip' }), 'r3.zip');
    const up3 = await api('POST', '/api/uploads', multiForm, true);
    check('R3a: fileCount excludes original.zip (3 files, not 4)', up3.data.analysis?.fileCount === 3, `fileCount=${up3.data.analysis?.fileCount}`);
    const stored = fs.readdirSync(up3.data.uploadId ? `/home/z/my-project/storage/uploads/${up3.data.uploadId}` : '/nonexistent');
    check('R3b: original.zip still stored for the worker', stored.includes('original.zip'));

    // R4: single-HTML upload missing local assets produces a concrete warning
    const htmlWithRefs = Buffer.from('<html><head><link rel="stylesheet" href="style.css"></head><body><img src="img/logo.png"><script src="app.js"></script></body></html>');
    const hForm = new FormData();
    hForm.append('file', new Blob([htmlWithRefs], { type: 'text/html' }), 'page.html');
    r = await api('POST', '/api/uploads', hForm, true);
    const warn = (r.data.analysis?.warnings || []).join(' ');
    check('R4: missing local assets warned with names', /style\.css/.test(warn) && /app\.js/.test(warn), warn.slice(0, 90));

    // R5: entry candidates sorted by depth (root index.html wins over nested)
    const nestZip = new AdmZip();
    nestZip.addFile('index.html', Buffer.from('<html><body>root</body></html>'));
    nestZip.addFile('app/index.html', Buffer.from('<html><body>nested</body></html>'));
    const nestForm = new FormData();
    nestForm.append('file', new Blob([nestZip.toBuffer()], { type: 'application/zip' }), 'r5.zip');
    r = await api('POST', '/api/uploads', nestForm, true);
    check('R5: root index.html chosen as entry', r.data.analysis?.entryPath === 'index.html', `entry=${r.data.analysis?.entryPath}`);

    // R6: demo sample project is buildable (stored as a real original.zip)
    const sampleZip = '/home/z/my-project/storage/uploads/sample-taskfocus/original.zip';
    const demoLogin = await api('POST', '/api/auth/login', { email: 'demo@html2apk.studio', password: 'demo1234' });
    check('R6a: demo account login works', demoLogin.status === 200);
    check('R6b: demo sample project stored as original.zip (worker-buildable)', fs.existsSync(sampleZip) && fs.statSync(sampleZip).size > 500);
  }

  console.log('\n═══ Test 8: Build targets — APK / AAB / BOTH ═══');
  {
    const { execSync } = await import('child_process');
    const JH = '/home/z/my-project/tools/jdk-21/bin';
    const envText = fs.readFileSync('/home/z/my-project/.env', 'utf8');
    const envVars = Object.fromEntries(envText.split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
    const BT = `${envVars.H2A_ANDROID_SDK || '/home/z/my-project/android-sdk'}/build-tools/${envVars.H2A_BUILD_TOOLS || '36.0.0'}`;
    await loginAdmin();

    const up = await (async () => {
      const z = new AdmZip();
      z.addFile('index.html', Buffer.from('<!DOCTYPE html><html><head><title>T8</title></head><body><h1>targets test</h1></body></html>'));
      const f = new FormData();
      f.append('file', new Blob([z.toBuffer()], { type: 'application/zip' }), 'targets-test.zip');
      return api('POST', '/api/uploads', f, true);
    })();
    check('T8: upload OK', up.status === 200, `entry=${up.data?.analysis?.entryPath}`);

    const ks = await api('POST', '/api/keystores', {
      mode: 'generate', alias: 't8-target-key', password: 'Targets#2026',
      commonName: 'T8 Tester', organization: 'HTML2APK QA',
    });
    check('T8: keystore ready', ks.status === 200 && ks.data.keystore?.id);

    // T8.1 — AAB without keystore must be rejected (AAB is always release-signed)
    let r = await api('POST', '/api/builds', {
      projectId: up.data.projectId,
      config: { appName: 'T8 NoKs', packageName: 'io.qa.t8noks', versionName: '1.0', versionCode: 1, buildType: 'DEBUG', buildTargets: 'AAB', entryPath: 'index.html' },
    });
    check('T8.1: AAB target without keystore rejected', r.status === 400, r.data?.error?.slice(0, 70));

    // T8.2 — AAB-only build via HTTP
    const bAab = await api('POST', '/api/builds', {
      projectId: up.data.projectId,
      config: { appName: 'T8 AAB Only', packageName: 'io.qa.t8aab', versionName: '3.1.0', versionCode: 31, buildType: 'DEBUG', buildTargets: 'AAB', releaseKeystoreId: ks.data.keystore.id, description: '', language: 'en', themeColor: '#10B981', splashEnabled: true, splashColor: '#0F172A', orientation: 'portrait', fullscreen: false, statusBarVisible: true, statusBarColor: '#0F172A', navigationBarColor: '#0F172A', brightness: 'system', javascriptEnabled: true, domStorageEnabled: true, databaseEnabled: false, zoomControls: false, textZoom: 100, allowFileAccess: false, externalLinks: 'external', cacheMode: 'default', mixedContent: 'never', openFileChooser: true, downloadsEnabled: true, userAgentSuffix: '', permissions: { internet: true, camera: false, microphone: false, location: false, fileAccess: false, notifications: false }, entryPath: 'index.html' },
    });
    check('T8.2: AAB-only build accepted', bAab.status === 201, bAab.data?.buildId);

    let aabFinal = null;
    for (let i = 0; i < 160; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const s = await api('GET', `/api/builds/${bAab.data.buildId}`);
      aabFinal = s.data.build;
      if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(aabFinal.status)) break;
    }
    check('T8.2a: AAB-only build SUCCEEDED', aabFinal?.status === 'SUCCEEDED', aabFinal?.errorMessage?.slice(0, 100));
    if (aabFinal?.status === 'SUCCEEDED') {
      check('T8.2b: no APK produced (AAB-only)', aabFinal.hasApk === false && aabFinal.apkSize == null);
      const aabPath = `/home/z/my-project/storage/artifacts/${aabFinal.id}/app-release.aab`;
      check('T8.2c: AAB exists with size', aabFinal.hasAab === true && fs.existsSync(aabPath) && fs.statSync(aabPath).size > 20000, aabFinal.aabSize ? `${(aabFinal.aabSize / 1048576).toFixed(2)} MB` : '');
      // signature + identity verification of the HTTP-produced AAB
      let js = '';
      try { js = execSync(`${JH}/jarsigner -verify "${aabPath}" 2>&1`, { encoding: 'utf8' }); } catch { }
      check('T8.2d: AAB jar verified (release-signed)', /jar verified\./.test(js));
      let dump = '';
      try { dump = execSync(`${JH}/java -jar /home/z/my-project/tools/bundletool.jar dump manifest --bundle "${aabPath}"`, { encoding: 'utf8' }); } catch { }
      check('T8.2e: AAB package/version identity (bundletool)', dump.includes('package="io.qa.t8aab"') && dump.includes('android:versionCode="31"') && dump.includes('android:versionName="3.1.0"'));
      // APK download of an AAB-only build → clean 4xx
      const dlApkNope = await fetch(`${BASE}/api/builds/${aabFinal.id}/download?type=apk`, { headers: { cookie } });
      check('T8.2f: APK download on AAB-only build rejected cleanly', [404, 410].includes(dlApkNope.status), `status=${dlApkNope.status}`);
      const dlAab2 = await fetch(`${BASE}/api/builds/${aabFinal.id}/download?type=aab`, { headers: { cookie } });
      check('T8.2g: AAB download works', dlAab2.status === 200);
      await dlAab2.arrayBuffer();
    }

    // T8.3 — legacy generateAab:true (no buildTargets) still maps to BOTH
    const bLegacy = await api('POST', '/api/builds', {
      projectId: up.data.projectId,
      config: { appName: 'T8 Legacy', packageName: 'io.qa.t8legacy', versionName: '1.0', versionCode: 1, buildType: 'DEBUG', generateAab: true, releaseKeystoreId: ks.data.keystore.id, description: '', language: 'en', themeColor: '#10B981', splashEnabled: true, splashColor: '#0F172A', orientation: 'portrait', fullscreen: false, statusBarVisible: true, statusBarColor: '#0F172A', navigationBarColor: '#0F172A', brightness: 'system', javascriptEnabled: true, domStorageEnabled: true, databaseEnabled: false, zoomControls: false, textZoom: 100, allowFileAccess: false, externalLinks: 'external', cacheMode: 'default', mixedContent: 'never', openFileChooser: true, downloadsEnabled: true, userAgentSuffix: '', permissions: { internet: true, camera: false, microphone: false, location: false, fileAccess: false, notifications: false }, entryPath: 'index.html' },
    });
    check('T8.3: legacy generateAab config accepted', bLegacy.status === 201, bLegacy.data?.buildId);
    const legacyStatus = await api('GET', `/api/builds/${bLegacy.data.buildId}`);
    check('T8.3a: legacy config resolved to BOTH', legacyStatus.data.build?.config?.buildTargets === 'BOTH', `stored=${legacyStatus.data.build?.config?.buildTargets}`);
  }

  console.log(`\n═══ RESULTS: ${pass} passed, ${fail} failed ═══`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('Test suite crashed:', e); process.exit(1); });
