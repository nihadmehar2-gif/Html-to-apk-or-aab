# HTML2APK Studio — QA Report

**Environment:** Debian 13 sandbox · OpenJDK 21.0.13 · Android SDK 34 / build-tools 34.0.0 · Gradle 8.9 · AGP 8.5.2 · Node 24 · Next.js 16 · SQLite
**Date:** 2026-10-30 · **Scope:** every check below was executed against the running platform. Nothing on this page is aspirational.

## Summary

| Suite | Result |
| --- | --- |
| API + security E2E suite (`scripts/e2e-tests.mjs`) | **37 / 37 passed** (run 3× after final fixes) |
| Browser golden path (agent-browser) | **passed** |
| Real artifact verification (apksigner / aapt2 / zip inspection) | **passed** |
| Responsive layout + light/dark themes | **passed** (desktop 1440, mobile 390) |
| On-device Android install | **NOT performed** — no Android device/emulator exists in this sandbox; APKs verified structurally (zip entries, badging, signature) instead |

---

## Test 1 — Single HTML conversion ✅
- Uploaded `sample.html` (inline CSS + JS + button) through `POST /api/uploads` → analyzed.
- Created DEBUG build via `POST /api/builds` → worker compiled with Gradle → `SUCCEEDED` in ~45 s (warm cache).
- Downloaded APK (3,011,184 bytes): `aapt2 dump badging` → `package: name='io.smoketest.html2app' versionCode='1' versionName='1.0'`; `assets/www/index.html` present; `apksigner verify` → debug cert valid.

## Test 2 — ZIP project conversion ✅
- Built `zipsite.zip` (index.html + css/style.css + js/app.js + img/icon.svg) and uploaded it **through the browser UI** (drag-drop input).
- Analyzer detected entry `index.html`, counted 5 files, flagged no external hosts.
- Browser-driven DEBUG build with custom values → `SUCCEEDED` (2.87 MB).
- ZIP inspection: `assets/www/{index.html, css/style.css, js/app.js, img/icon.svg}` — folder structure and relative paths intact.

## Test 3 — Application settings applied ✅
Browser build configured with appName "Mini Shop", package `com.minishop.webapp`, v1.0 (1), portrait:
- badging: `name='com.minishop.webapp' versionCode='1' versionName='1.0'`
- manifest: `screenOrientation=1` (portrait)
- API release build configured with `io.qa.releasetest`, v2.5.1 (7), **landscape**, keystore CN "E2E Tester":
  - badging + manifest verified all four values (landscape `screenOrientation=0` confirmed)
  - `application-label:'Release Test App'` confirmed

## Test 4 — APK signing ✅
- **Debug**: auto-generated debug keystore (`CN=Android Debug`), `apksigner verify` passed on every build.
- **Release**: keystore generated via API (`keytool`, RSA-2048/10950 days); release APK signed and verified — cert DN matches the user keystore (`CN=E2E Tester, O=HTML2APK QA`).
- **AAB**: `bundleRelease` produced a 2.18 MB bundle; structure verified (`BundleConfig.pb` + `base/manifest/AndroidManifest.xml`).
- Wrong-password keystore uploads rejected with a clear validation error; corrupt keystores rejected.

## Test 5 — Error handling ✅
| Case | Result |
| --- | --- |
| Reserved Java keyword package (`com.while.bad`) | `400` — "while is a reserved Java keyword…" |
| Malformed package (`not-a-package`) | `400` — reverse-domain guidance |
| Text file named `.zip` | `400` — "Corrupted ZIP archive … missing PK header" |
| Non-HTML text file named `.html` | `415` — markup sniff failure |
| `.exe` upload | `415` unsupported |
| ZIP without `index.html` | upload OK + warning; build attempt → `422 needsEntrySelection` + `htmlFiles[]` |
| Build with user-selected entry (`about.html`) | `201` → `SUCCEEDED` |
| Release build without keystore | `400` with signing guidance |
| Gradle failure path (observed during development) | worker captured compiler errors, DB `FAILED`, human-readable message + full logs retained |

## Test 6 — Security ✅
| Case | Result |
| --- | --- |
| ZIP with raw `../` traversal + absolute-path entries (crafted fixture) | `400` — "Unsafe ZIP entry rejected — path traversal not allowed: ../../../../tmp/pwned-raw.txt"; no file escaped to parent dirs |
| Upload of non-zip with .zip name | rejected (no silent acceptance) |
| Download without session | `401` |
| Build status of another user's build | `401` |
| Admin endpoints anonymous / normal user | `401` / `403` |
| Owner download | `200` with correct MIME + filename |
| Keystore password in build logs | **absent** (masked); alias visible only |
| Workspaces | per-build isolated, removed on success, janitor purges old ones |
| Uploaded HTML/JS | never executed server-side — only copied into APK assets |

## Test 7 — Interface ✅ (with a noted environment caveat)
- Desktop 1440×900: hero 2-col, feature grid 3-col, sticky build bar, sticky footer (flex `mt-auto`).
- Mobile 390×844: single column, 44px+ touch targets, stacked cards, footer sticks.
- Light + dark themes verified via `next-themes` class strategy.
- Hydration nesting error (`Badge` inside `CardDescription`'s `<p>`) found via browser console and fixed; console now clean.
- Golden path exercised in-browser: demo login → ZIP upload → analysis → configure → live Gradle logs → result → download → dashboard → admin (stats/users/system tabs).
- **Caveat:** the dev server was OOM-killed once by the kernel (4 GB RAM) while three Gradle builds ran back-to-back during testing; Gradle heap was reduced to 1536 MB and the suite then passed 3× consecutively. Production sizing in DEPLOYMENT.md recommends 4–8 GB.

## Not verified here (honest gaps)
1. **Real-device install** — no Android device/emulator available in this sandbox. The APKs are standard signed Android packages and were verified with the official tools (`apksigner`, `aapt2`), but an on-device smoke test is the user's first step after deploying.
2. **WebView runtime behaviors** (file chooser, WebRTC prompts, downloads) are implemented in the generated `MainActivity` per Android documentation but not exercised on a device here.
3. **Google Play submission** flow (AAB upload) — AAB structure verified only.
