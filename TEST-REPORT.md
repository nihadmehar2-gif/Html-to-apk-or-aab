# HTML2APK Studio — Test Report

**Date:** 2026-11-05 · Environment: sandbox Linux x64, Node v24.22.2, 4 GB RAM

All commands below were actually executed against the running platform
(`next dev -p 3000`) and the real Gradle build engine.

---

## 1. Toolchain verification

```
$ bash scripts/sdk-setup.sh
[1/6]  Gradle 8.11.1 … ok ("Gradle 8.11.1", JVM 21.0.13)
[1b/6] Temurin JDK 21 … javac 21.0.13
[2/6]  SDK packages (dl.google.com) … clt 153 MB, bt36 63 MB, plat36 65 MB, ptools 9 MB
[3-5]  unpack + licenses + permissions … ok
[6/6]  aapt2 version → Android Asset Packaging Tool (aapt) 2.20-13193326
       android.jar OK (27M)
SDK_SETUP_COMPLETE
```

```
$ curl -s localhost:3000/api/system/health
{"ok":true,"engineReady":true,"queue":{"running":0,"queued":0,"maxConcurrent":1},"version":"1.0.0"}
```

## 2. TypeScript / static checks

```
$ npx tsc --noEmit        → exit 0 (0 errors, was 9 errors before fixes)
$ next.config.ts          → typescript.ignoreBuildErrors REMOVED
```

## 3. Real builds (Gradle, not simulated)

| Build | Command | Result | Time | Artifacts |
| --- | --- | --- | --- | --- |
| Prewarm debug | `node scripts/test-build.mjs DEBUG` | **BUILD SUCCEEDED** | 0.5 min | `app-debug.apk` 3.14 MB |
| Prewarm release + AAB | `node scripts/test-build.mjs RELEASE --aab` | **BUILD SUCCEEDED** | 1.8 min | `app-release.apk` 2.47 MB + `app-release.aab` 2.37 MB |

`aapt2 dump badging` on the produced debug APK:

```
package: name='studio.html2apk.prewarm5112' versionCode='1' versionName='1.0.0'
platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36'
targetSdkVersion:'36'
```

`apksigner verify --print-certs` on both APKs: **Verifie[d]**, signer certs match
the respective keystores (debug: `CN=Android Debug`; release: user keystore).

APK content checks: `assets/www/` contains all 4 site files;
`assets/webview-config.json` → `"startUrl": "https://appassets.androidplatform.net/assets/www/index.html"`.

## 4. Full E2E suite (real HTTP API + real builds)

```
$ node scripts/e2e-tests.mjs
Test 4  Release APK + AAB signing ……………… 18/18 ✅
Test 5  Error handling ……………………………… 9/9 ✅
Test 6  Security ………………………………………… 10/10 ✅
Test 7  Regressions (Nov 2026 fixes) …… 8/8 ✅
(Test 1–3 auth/upload/basic build also pass inside the same run)

═══ RESULTS: 45 passed, 0 failed ═══
```

Highlights (all via the real API):
- Release build signed with a **user-generated keystore** — cert `CN=E2E Tester` confirmed via apksigner.
- Corrupt keystore rejected at upload; **valid keystore + wrong password rejected** (R1).
- entryPath traversal (`../../etc/hosts`) → **400** (R2).
- `original.zip` excluded from file counts but stored for the worker (R3a/R3b).
- Single-HTML missing-asset warning names the exact files (R4).
- Root `index.html` beats nested one for entry selection (R5).
- Demo account login + buildable sample project (R6a/R6b).
- ZIP path traversal fixture rejected; no file escaped the upload dir.
- Keystore passwords never appear in build logs (masking verified).

## 5. Browser golden path (agent-browser, Chromium)

Flow executed against `http://localhost:3000`:

1. Landing page loads → **0 console errors, 0 page errors**.
2. Sign in as `demo@html2apk.studio` → redirected to Upload.
3. Uploaded a real ZIP via the file input (`DOM.setFileInputFiles`) → analyzer panel
   rendered with file badges, entry selector and **Configure app** button.
4. Configure view → **Entry HTML page** selector present → **Build Debug APK** clicked.
5. Build pipeline view streamed live Gradle output (52% …) → finished **SUCCEEDED**.
6. Result view showed **Download APK (3.14 MB)** — clicked; the browser actually
   downloaded `golden-site-v1.0-debug.apk`; the served file passes
   `apksigner verify` (re-downloaded via API too: HTTP 200, 3,287,746 bytes).

## 6. Distribution package sanity (sanitized ZIP)

```
$ bash scripts/make-dist.sh            # builds download/html2apk-studio-dist.zip
$ unzip -t download/html2apk-studio-dist.zip   → no errors
$ grep scan of all packaged files for secrets:
  - no .env, no .h2a_secret, no keystore files, no SQLite DB, no user uploads
  - H2A_* placeholders only in .env.example (template values)
```

Excluded from the package: `.env*` (real), `db/`, `storage/` (incl. keystores,
artifacts, uploads, secrets), `tools/`, `android-sdk/`, `.gradle-home/`,
`node_modules/`, `.next/`, `download/`, `upload/`, logs, sandbox-only dirs.

## 7. Not tested (honest disclosure)

- Runtime behavior of generated APKs on a real Android device or emulator —
  **no Android emulator exists in this sandbox**. See REMAINING-ISSUES.md §1 for
  the exact manual test checklist.
- Google Play submission (target 36 + AAB) — requires a Play console account.
