# HTML2APK Studio

Convert any HTML file or complete ZIP website project into a **real, installable Android APK** — compiled with the actual Android SDK, Gradle and JDK on the server. Not a wrapper demo: every build generates a fresh Android project, runs `gradle assembleDebug` / `assembleRelease`, signs the artifact and verifies it with `apksigner` before download.

![stack](https://img.shields.io/badge/Android_SDK-36-3DDC84) ![gradle](https://img.shields.io/badge/Gradle-8.11.1-02303A) ![jdk](https://img.shields.io/badge/JDK-21-007396) ![agp](https://img.shields.io/badge/AGP-8.9.2-3DDC84)

## Feature overview

| Area | What you get |
| --- | --- |
| **Conversion modes** | Mode A: single `.html`/`.htm` file · Mode B: complete ZIP website project |
| **Real build engine** | Isolated Gradle builds (Android SDK 34, AGP 8.5.2, JDK 17+/21) with live compiler logs |
| **App configuration** | Name, package, version, description, language, icon (all densities), splash, colors, orientation, fullscreen, brightness |
| **WebView controls** | JavaScript, DOM storage, WebSQL, zoom, text zoom, file access, file chooser, downloads, cache mode, mixed-content policy, external link policy, UA suffix |
| **Permissions** | Internet / Camera / Microphone / Location / File access / Notifications — each explained, nothing enabled silently |
| **Signing** | Auto debug keystore · release with your own keystore (upload or generate) · passwords AES-256-GCM encrypted, never logged · optional AAB |
| **Accounts** | Register/login (scrypt + JWT httpOnly cookies), dashboard, build history, rebuild, delete, admin dashboard |
| **Security** | ZIP path-traversal & bomb protection, upload validation, isolated workspaces, worker timeouts, concurrency limits, rate limiting, artifact retention (7 days) |
| **Ops** | REST API, health endpoints, admin stats, storage monitoring, Docker deployment |

## Quick start (development)

Requirements: Node.js 20+, Bun (or npm), JDK 17+ (`javac` on PATH), Android SDK + build-tools 34 + platform android-34, Gradle 8.x.

```bash
bun install                 # or npm install
cp .env.example .env        # adjust paths if needed
bunx prisma db push         # create SQLite database
bun run dev                 # http://localhost:3000
```

Seeded accounts (created automatically on first API call):

| Account | Email | Password |
| --- | --- | --- |
| Admin | `admin@html2apk.studio` | `Admin#2026` |
| Demo (sample project) | `demo@html2apk.studio` | `demo1234` |

## How a build works

```
POST /api/uploads ──► validate + safe-extract + analyze (entry file, external hosts)
POST /api/builds  ──► validate config (zod) ──► queue build
                    ┌──────────── detached worker (scripts/build-worker.mjs) ───────────┐
                    │ 1. isolated workspace  2. safe ZIP extraction                     │
                    │ 3. generate Android project (manifest, res, icons via sharp,      │
                    │    Java WebView activity, webview-config.json)                    │
                    │ 4. gradle assembleDebug / assembleRelease [+ bundleRelease]       │
                    │ 5. apksigner verify + aapt2 badging + zip structure checks        │
                    │ 6. publish artifacts, update DB, cleanup workspace                │
                    └───────────────────────────────────────────────────────────────────┘
GET /api/builds/:id/logs?offset=N ──► live build logs (poll every ~2s)
GET /api/builds/:id/download?type=apk|aab ──► verified artifact
```

The frontend is a single-page app (Next.js 16 App Router) with views for landing, auth, upload, configuration, live build progress, results, dashboard and admin — light/dark theme included.

## Generated Android app

Every APK contains:

- **Java `MainActivity`** (package `com.html2apk.studio.wv`, `applicationId` = your package name) implementing:
  - back-button navigation, loading progress bar, JS `alert/confirm/prompt` dialogs
  - file chooser (`ACTION_GET_CONTENT` + camera capture via FileProvider)
  - DownloadManager integration for http(s) downloads
  - WebRTC permission bridge (`onPermissionRequest`) and Geolocation prompt
  - offline error page, external link handling (browser / in-app / ask), mixed-content policy
  - status/navigation bar colors, fullscreen immersive mode, brightness, app language (`AppCompatDelegate.setApplicationLocales`)
- **`AndroidManifest.xml`** with only the permissions you enabled, screen orientation, cleartext policy
- **Launcher icons** at mdpi→xxxhdpi + round icons + splash logo (from your upload or a generated default)
- **Your website** in `assets/www/` with the original folder structure and relative paths

`minSdk 24` (Android 7.0) · `targetSdk/compileSdk 36` (Android 16, Play 2026-ready) · `androidx.appcompat 1.7.1` + `androidx.webkit 1.14.0` (WebViewAssetLoader secure origin).

## Repository layout

```
├── android-template/          # Android project template (compiled per build)
├── scripts/
│   ├── build-worker.mjs       # the real build engine (detached worker process)
│   ├── e2e-tests.mjs          # end-to-end test suite (API driven)
│   └── sdk-setup.sh           # Android SDK / Gradle installation helper
├── src/
│   ├── app/api/               # REST API (auth, uploads, builds, keystores, admin, health)
│   ├── components/studio/     # SPA views (landing, upload, config, build, dashboard, admin)
│   └── lib/                   # config, auth, security, build queue, app-config schema
├── prisma/schema.prisma       # SQLite schema (users, projects, builds, keystores, logs)
├── DEPLOYMENT.md              # production setup guide (JDK/SDK/Gradle/Docker)
├── API.md                     # REST API reference
└── QA-REPORT.md               # executed test results (real builds, security, UI)
```

## Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)** — server requirements, JDK 17 / Android SDK / Gradle installation, Docker Compose, worker configuration, storage sizing
- **[API.md](API.md)** — every endpoint with request/response examples
- **[QA-REPORT.md](QA-REPORT.md)** — the exact tests executed against this deployment and their results

## Security model (summary)

- Uploaded projects are **untrusted data**: never executed, only copied into APK assets
- ZIP entries validated against traversal/absolute paths/reserved names before any write
- Upload limits: 50 MB archive, 400 MB decompressed, 3,000 files
- One isolated workspace per build; workers run with timeouts and kill trees on cancel
- Keystore passwords encrypted at rest (AES-256-GCM), passed to Gradle via process env only
- Downloads restricted to the owner (or admin), every download logged, artifacts auto-expire (7 days)
- Rate limits on auth (15/min), uploads (20/h), builds (10/h), downloads (60/min)
