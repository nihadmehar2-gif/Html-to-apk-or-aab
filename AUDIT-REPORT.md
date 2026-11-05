# HTML2APK Studio — Audit & Fix Report

**Date:** 2026-11-05 · **Scope:** production-readiness pass requested after the
reported failure `gradle spawn error: spawn /home/z/my-project/tools/gradle-8.9/bin/gradle ENOENT`.

Legend: **Critical** = breaks the product or leaks data · **High** = wrong behavior,
security weakness, or Play-Store blocker · **Medium** = quality/robustness · **Low** = polish.

---

## A. Root cause of the reported build failure

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| A1 | `spawn …/tools/gradle-8.9/bin/gradle ENOENT` — every build failed at 52% | **Critical** | The Gradle/SDK/JDK toolchain lived in `/home/z/.toolchain/` **outside** the project directory; the runtime environment was recycled and wiped it. `.env` had also lost the `H2A_*` variables, so the code fell back to the (missing) default path. | 1) Toolchain now installs **inside the project** (`tools/`, `android-sdk/`, `.gradle-home/`) via a rewritten, self-contained `scripts/sdk-setup.sh` (Gradle 8.11.1, Temurin JDK 21, SDK 36, idempotent, mirror fallback). inotify exhaustion is prevented separately (see B2), so keeping it inside is safe. 2) `.env` restored with all `H2A_*` vars. 3) Worker now fails with an actionable message (`Run scripts/sdk-setup.sh or set H2A_GRADLE_BIN`) instead of a bare ENOENT, and validates Gradle existence **before** claiming progress. | `GET /api/system/health` → `engineReady: true`; real debug + release builds succeed end-to-end |
| A2 | Missing `javac` (JRE-only system Java) would have failed compile even with Gradle present | **Critical** | System had OpenJDK 21 **JRE** only; Gradle needs a full JDK to compile `MainActivity.java`. | Bundled Temurin JDK 21 at `tools/jdk-21`; `config.javaHome` and the worker both prefer the bundled JDK over an ambient JRE-only `JAVA_HOME`, and fail fast with `No Java compiler (javac) found under JAVA_HOME=…` if absent. | `javac -version` → 21.0.13; builds compile MainActivity successfully |

## B. Build engine & queue

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| B1 | QUEUED builds could be claimed twice (duplicate Gradle processes) | **High** | `pumpQueue()` only read rows; two concurrent triggers (API POST + janitor) could both spawn a worker for the same build. | Atomic claim: `updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'RUNNING' } })` — the spawn happens only when `count === 1`. Spawn failure puts the build in FAILED with a clear message instead of limbo. | Code review; single-claim logic exercised on every build in the 45-test suite |
| B2 | Toolchain file watching could exhaust the sandbox inotify budget (8192) | **High** (in dev) | Gradle VFS watcher + Next.js dev watcher on the same tree. | `org.gradle.vfs.watch=false` in the template `gradle.properties`; heavy dirs (`android-sdk/`, `tools/`, `.gradle-home/`, `storage/`) listed in `.gitignore` (honored by the Turbopack watcher). The invalid `turbopack.watch` config key (TS error) was removed. | `next dev` + two real Gradle builds ran concurrently with no watcher errors |
| B3 | Stale-worker janitor could kill freshly-claimed builds | Medium | No grace period between claim and the worker's first heartbeat. | 90-second startup grace (`startedAt`) before stale detection applies. | Code review |
| B4 | Worker spawned via `spawn('node', …)` — PATH-dependent | Medium | If PATH lacked `node`, workers could not start. | Uses `process.execPath` with `'node'` fallback. | Code review |
| B5 | Hardcoded `/home/z/my-project` in worker + queue | Medium | Broke any non-sandbox deployment. | Worker derives `ROOT` from `import.meta.url`; queue passes resolved `H2A_ROOT` from `config`; `config.ROOT` = `process.cwd()` default. | tsc clean; API builds work |

## C. Android compatibility (Play requirement)

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| C1 | compileSdk/targetSdk 34 (Play requires target 35+ since Aug 2025, 36 by Aug 2026) | **High** | Old template. | compileSdk 36, targetSdk 36 (minSdk 24), AGP 8.5.2 → **8.9.2**, Gradle 8.9 → **8.11.1**, build-tools 34 → **36.0.0**, appcompat 1.6.1 → **1.7.1**, added webkit **1.14.0**. | `aapt2 dump badging` on produced APK: `targetSdkVersion:'36'`, `compileSdkVersion='36'` |
| C2 | Android 15/16 edge-to-edge: `setStatusBarColor` ignored on API 35+, `setDecorFitsSystemWindows` deprecated | **High** | Template relied on legacy window APIs. | Always-draws-edge-to-edge layout: runtime inset listener positions `contentWrap` (top/bottom/left/right + IME-aware keyboard resize) and runtime-sized scrim views reproduce status/navigation bar colors on every API level. Fullscreen mode still hides bars. | Compile + review; runtime behavior NOT TESTED on a device (see Remaining Issues) |
| C3 | Duplicate kotlin classes (`kotlin-stdlib:1.8.22` vs `kotlin-stdlib-jdk8:1.6.21` transitive pin) broke every build after the AndroidX bump | **High** | Known androidx classpath-sync issue. | `resolutionStrategy.force` pins kotlin-stdlib/jdk7/jdk8 to 1.8.22 (jdk8 is an empty stub since 1.8.0) in the generated `app/build.gradle`. | Real builds compile cleanly (52 s debug, 1.8 min release+AAB) |
| C4 | webkit 1.14.0 API mismatch (`shouldInterceptRequest(Uri)` — no `shouldOverrideUrlLoading`) | Medium | API drift between webkit versions. | Code adjusted to the verified 1.14.0 API (checked via `javap` on the AAR). | Builds compile |

## D. WebView runtime (packaged websites)

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| D1 | `file:///android_asset/www/` start URL breaks root-relative paths, ES modules, `fetch`/XHR origins, and paints canvas as tainted | **High** | Legacy file:// hosting. | Packaged sites are now served over **WebViewAssetLoader** on the secure origin `https://appassets.androidplatform.net/assets/www/…`; `shouldInterceptRequest` delegates to the asset loader; `isLocalAssetUri` recognizes the new origin; `allowFileAccess` now defaults to **false** (schema, UI, worker, WebView). | APK `assets/webview-config.json` shows the new startUrl; runtime NOT TESTED on device (disclosed) |
| D2 | `blob:` downloads (canvas exports, client-generated CSV/PDF) could not be saved | Medium | DownloadManager cannot fetch `blob:` URLs. | `H2ABlob` JS bridge + injected shim: intercepts `<a download href="blob:…">` clicks, base64s the payload, saves via MediaStore Downloads (API 29+) or app-specific dir (≤28), with toast feedback. Only registered when downloads are enabled. | Compile + code review; runtime NOT TESTED on device |
| D3 | `intent://` links failed in the external-app path | Medium | Raw `intent://` URIs are not startable via ACTION_VIEW. | `Intent.parseUri(…, URI_INTENT_SCHEME)` + `browser_fallback_url` fallback. | Code review |
| D4 | Legacy `file://` default conflicted with the secure-origin design | Medium | Old default `allowFileAccess: true` in schema/UI/worker. | Default flipped to `false` everywhere; UI toggle copy updated; worker honors explicit opt-in only. | E2E config propagation; tsc clean |

## E. Uploads & ZIP handling

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| E1 | Entry-file ranking used `b.split(' ')` instead of `b.split('/')` — wrong depth sort, could pick a nested `index.html` | **High** | Typo in comparator. | Fixed; deepest-vs-shallowest logic verified. | E2E R5: root `index.html` wins over `app/index.html` |
| E2 | `original.zip` (re-stored archive) counted as a project asset → inflated file counts | Medium | Archive written before analysis. | Archive is written **after** `analyzeDirectory()`; single-HTML `totalBytes` no longer double-counts. | E2E R3a/R3b |
| E3 | Single-HTML uploads referencing local files got no warning about the missing assets | Medium | No detection. | Analyzer extracts relative `src`/`href` refs and warns with concrete filenames + guidance to upload a ZIP instead. | E2E R4 (warns for `style.css`, `img/logo.png`, `app.js`) |
| E4 | No UI to pick the entry page when a ZIP has no root `index.html` | **High** | `entryError` was shown with no control. | Config page now has an **Entry HTML page** selector (lists analyzed HTML files + free-text option); upload page already had one — warnings from the analyzer are now also surfaced in the config view. | Browser golden path: ZIP upload → entry visible → build succeeds with `about.html` entry |
| E5 | ZIP bombs / traversal | — (already good) | — | Existing guards kept (max 3000 files, 400 MB unpacked, per-entry checks, traversal rejection, reserved names, Windows device names). | E2E Test 6: traversal fixture rejected, nothing escaped |

## F. Security & accounts

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| F1 | `entryPath` accepted `../` and absolute paths in the build API | **High** | Only the worker validated it. | Builds API rejects absolute paths, `..` segments, backslashes and control characters with HTTP 400; the worker re-validates independently (defense in depth). | E2E R2 → 400 |
| F2 | Release builds could spend minutes in Gradle before discovering a bad keystore password | Medium | Keystore only checked implicitly. | Worker pre-flight: `keytool -list -storepass:env H2A_KS_PW -alias …` (password via env, never an argv) before Gradle; specific messages for wrong password vs missing alias vs corrupt file. | Real release builds verify the keystore first (`Keystore verified: password OK and alias present` in logs); API-side wrong-password upload rejected — E2E R1 |
| F3 | Default admin password was always `Admin#2026`; demo account created unconditionally | Medium | Fixed seed values. | `H2A_SEED_ADMIN_PASSWORD` overrides; demo account is skipped in production unless `H2A_SEED_DEMO=true`. Existing sandbox/demo credentials untouched (per request). | Code review; demo login still works (E2E R6a) |
| F4 | Distribution ZIP contained `.env`, SQLite DB, keystores, user uploads, generated artifacts | **Critical** (for redistribution) | Packaging script excluded only build outputs. | New sanitized packaging (see deliverables) excludes `.env*`, `db/`, `storage/`, `download/`, `upload/`, toolchain dirs, logs; ships `.env.example` instead. **Existing production signing keys in `storage/keystores` were NOT modified or removed.** | `unzip -l` + grep scan of the package for secrets (see TEST-REPORT §6) |

## G. Deployment & build quality

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| G1 | `npm start` required Bun (`bun .next/standalone/server.js`) while the Docker image only had Node.js | **High** | Script/runtime mismatch. | `start` now runs `node .next/standalone/server.js` (works everywhere; Bun still fine for dev); Dockerfile stays Node-based; Docker toolchain updated to JDK 21 / SDK 36 / Gradle 8.11.1. | Package.json + Dockerfile review; local start path compiles via `next build` config (tsc clean) |
| G2 | `typescript.ignoreBuildErrors: true` hid type errors | Medium | Scaffolding leftover. | Removed; all TS errors fixed (7 across examples/next-config/admin-stats/uploads/build-queue/admin-view); `npm run typecheck` (`tsc --noEmit`) now passes and `next build` type-checks. | `tsc --noEmit` → exit 0 |
| G3 | `examples/`, `skills/`, `scripts/` (plain JS) pulled into tsc | Low | tsconfig include-all. | Excluded non-app dirs from tsconfig. | tsc clean |
| G4 | Health endpoint didn't check JDK | Low | — | Already checks aapt2+gradle+javac — verified all three paths resolve after the toolchain restore. | `/api/system/health` → `engineReady: true` |

## H. Demo seeding

| # | Finding | Severity | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| H1 | Demo project seeded loose files but the worker consumes `original.zip` → demo builds always failed | **High** | Seed layout mismatch. | Seed now builds a real `original.zip` via adm-zip; existing DBs get the archive via the same layout (migration applied in place); project size reflects the real archive. | E2E R6b; demo sample listed and buildable |
