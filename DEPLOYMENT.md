# HTML2APK Studio — Deployment & Production Setup Guide

This platform performs **real Android compilation**. The machine running the build
engine must have the Android SDK, a full JDK and Gradle installed — a normal static
hosting service (Vercel/Netlify style) **cannot** run it. This guide covers a
single-box install (web app + build engine) and the optional Docker variant.

Toolchain versions deployed by this release: **Temurin JDK 21 · Android SDK
platform 36 · build-tools 36.0.0 · Gradle 8.11.1 · Android Gradle Plugin 8.9.2.**

---

## 1. Minimum server requirements

| Resource | Minimum | Recommended |
| --- | --- | --- |
| CPU | 2 vCPU | 4+ vCPU (Gradle is CPU-hungry) |
| RAM | 3 GB | 4–8 GB (`org.gradle.jvmargs=-Xmx1536m`–`2048m` + aapt2) |
| Disk | 12 GB | 40 GB+ (SDK ≈ 0.5 GB, JDK ≈ 0.3 GB, Gradle cache ≈ 1–2 GB, artifacts grow with usage) |
| OS | Linux x64 (Debian/Ubuntu) | Ubuntu 22.04+ |
| Network | access to `dl.google.com`, `services.gradle.org`, `maven.google.com` (or regional mirrors) | — |

Storage sizing: artifacts ≈ 3 MB per build; uploads ≈ upload size × 7-day retention.
`H2A_RETENTION_DAYS` and janitor cleanup control growth.

## 2. JDK, SDK and Gradle

### 2a. One-command install (recommended)

The bundled setup script installs everything into the project directory
(`<root>/tools` + `<root>/android-sdk`) and is idempotent — safe to re-run:

```bash
npm run setup:toolchain        # or: bash scripts/sdk-setup.sh
```

It installs: Temurin JDK 21 (with `javac`), Gradle 8.11.1, Android cmdline-tools,
platform-tools, `platforms;android-36`, `build-tools;36.0.0`, pre-accepted SDK
licenses, and falls back to the Tencent mirror if `dl.google.com` is unreachable.

### 2b. Manual install (production servers usually prefer /opt)

```bash
# ---- JDK 21 (full JDK with javac — a JRE is NOT enough) ----
sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless
javac -version    # must print javac 21.x

# ---- Android SDK ----
export SDK=/opt/android-sdk && sudo mkdir -p $SDK
curl -sSL -o /tmp/clt.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
sudo unzip -q /tmp/clt.zip -d $SDK/cmdline-tools
sudo mv $SDK/cmdline-tools/cmdline-tools $SDK/cmdline-tools/latest
yes | $SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK --licenses
yes | $SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK \
  "platform-tools" "build-tools;36.0.0" "platforms;android-36"
sudo chown -R $USER:$USER $SDK

# ---- Gradle 8.11.1 ----
curl -sSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.11.1-bin.zip
sudo unzip -q /tmp/gradle.zip -d /opt && sudo chown -R $USER:$USER /opt/gradle-8.11.1
/opt/gradle-8.11.1/bin/gradle --version
```

## 3. Application setup

```bash
git clone <your-repo> /opt/html2apk && cd /opt/html2apk
npm install            # or: bun install
cp .env.example .env   # then edit (§4)
npx prisma db push     # or prisma migrate deploy for production databases
```

## 4. Environment variables (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:./db/custom.db` | SQLite file (swap to Postgres provider for clusters) |
| `H2A_ANDROID_SDK` | `<root>/android-sdk` | Android SDK root |
| `H2A_JAVA_HOME` | `<root>/tools/jdk-21` → `$JAVA_HOME` | JDK with `javac` |
| `H2A_GRADLE_BIN` | `<root>/tools/gradle-8.11.1/bin/gradle` | Gradle executable |
| `H2A_GRADLE_USER_HOME` | `<root>/.gradle-home` | Gradle dependency cache |
| `H2A_BUILD_TOOLS` | `36.0.0` | build-tools version (must match the SDK install) |
| `H2A_MAVEN_MIRROR` | `aliyun` | `aliyun` = regional mirrors, anything else = google()/mavenCentral() |
| `H2A_STORAGE_DIR` | `<root>/storage` | uploads, artifacts, keystores, workspaces, logs |
| `H2A_MAX_CONCURRENT_BUILDS` | `1` | parallel build workers (raise on 4+ vCPU boxes) |
| `H2A_BUILD_TIMEOUT_MIN` | `25` | hard kill timeout per build |
| `H2A_RETENTION_DAYS` | `7` | artifact retention before janitor purge |
| `H2A_ROOT` | process working directory | app root (locates android-template + worker) |
| `H2A_SEED_ADMIN_PASSWORD` | demo default | password for `admin@html2apk.studio` created on first run — **change it in production** |
| `H2A_SEED_DEMO` | unset | set `true` to also create `demo@html2apk.studio` in production |

Secrets: a 48-byte hex secret is auto-generated at `<storage>/.h2a_secret` (mode 0600)
and used for JWT signing + keystore-password encryption. Back it up; without it saved
keystore passwords cannot be decrypted.

Gradle dependency pre-warm (first build downloads ~1–2 GB into `H2A_GRADLE_USER_HOME`):

```bash
cd /opt/html2apk && node scripts/test-build.mjs DEBUG
```

## 5. Run in production

```bash
npm run build        # next build (standalone output) — TypeScript errors fail the build
npm run start        # NODE_ENV=production node .next/standalone/server.js  (PORT=3000)
```

Both scripts are plain Node.js — no Bun required. (Bun works too if you prefer it.)

Put Nginx/Caddy in front for TLS; set the session cookie `secure: true`
(`src/lib/auth.ts`) when terminating HTTPS on the proxy.

### Scaling workers out

The build engine is intentionally decoupled: `scripts/build-worker.mjs` is a
standalone process driven only by the database + env. To run builds on separate
machines, mount the same storage volume (NFS/EFS) on the workers, point them at
the same database, and run a tiny queue-pump loop on each worker host:

```bash
while true; do
  node -e "import('./src/lib/build-queue.ts')" # or replicate pumpQueue()
  sleep 5
done
```

Artifacts are shared through `H2A_STORAGE_DIR/artifacts/<buildId>`.
Queued builds are claimed atomically (`UPDATE … WHERE status='QUEUED'`), so
multiple pump processes never start the same build twice.

## 6. Docker deployment

`docker-compose.yml` (provided) starts the app + build engine in one container and
Postgres as an optional database. Build once, then:

```bash
docker compose up -d --build
# platform:      http://localhost:3000
```

The image installs Temurin JDK 21, Android cmdline-tools, build-tools 36, platform
36 and Gradle 8.11.1 (~4 GB image). Mount volumes:

- `h2a-storage` → `/app/storage` (uploads/artifacts/keystores — **persist me**)
- `h2a-gradle` → `/root/.gradle` (dependency cache — speeds up every build)

For a multi-container split, run the same image twice: once with the app command
and once with a worker command (`H2A_WORKER_ONLY=1` keeps the queue pump running).

## 7. Operations

- **Health**: `GET /api/system/health` (public) shows engine readiness + queue depth.
  `GET /api/admin/system` (admin) shows tool checks, load, memory, workspaces.
- **Janitor**: runs lazily on build-status API calls — expires artifacts past
  retention, fails builds with dead workers (heartbeat + pid check, 90 s startup
  grace), deletes old workspaces, restarts queued builds.
- **Logs**: build logs at `<storage>/logs/<buildId>.log`; secrets are masked.
- **Backups**: `db/custom.db` (or Postgres dump) + `storage/keystores` + `.h2a_secret`.

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `engineReady: false` in health | Check §2 paths against `.env`; run `aapt2 version`, `gradle --version`, `javac -version` |
| `spawn …gradle ENOENT` | Toolchain missing — run `npm run setup:toolchain`, or point `H2A_GRADLE_BIN` at a valid Gradle binary |
| `No Java compiler (javac) found` | `H2A_JAVA_HOME` points at a JRE — install a full JDK or the bundled one (`tools/jdk-21`) |
| First build extremely slow | Gradle is downloading AGP/androidx (~1–2 GB) — pre-warm once (§4 note) |
| `Build timed out` | Raise `H2A_BUILD_TIMEOUT_MIN` or reduce project size; check CPU |
| `Licenses not accepted` | Re-run sdkmanager licenses step (§2b) |
| 429 responses | Rate limits reached — tune `src/lib/config.ts` limits |
| Duplicate kotlin-stdlib classes | Already fixed in the generated `app/build.gradle` (resolutionStrategy force 1.8.22) |
| inotify watch exhaustion in dev | Fixed: toolchain dirs are excluded from the Next.js watcher (`.gitignore` + Turbopack) and Gradle runs with `org.gradle.vfs.watch=false` |

## 9. Why Vercel / Netlify / serverless hosting is not supported

HTML2APK Studio runs **real Gradle builds on the server**. That requires a
long-running Node process, a ~2 GB local toolchain (JDK 21, Gradle 8.11.1,
Android SDK 36), a writable persistent filesystem for `storage/` + `db/`, and
single builds that run 2–15 minutes. Serverless platforms cannot provide any
of these:

| Requirement | Vercel limit |
| --- | --- |
| Function bundle size | 250 MB unzipped — the toolchain alone is ~2 GB |
| Execution time | 60 s (Hobby) / 300 s (Pro) per invocation; Gradle builds take 2–15 min |
| Filesystem | read-only outside ephemeral `/tmp`; `storage/` and the SQLite `db/` cannot persist between requests |
| Background workers | not supported — the build worker, heartbeat reaper and queue need a live process |

Deploying only the UI would produce a platform where every build fails. This
project never fakes builds, so serverless targets are unsupported by design.

### Vercel note: framework pin + what a Vercel deployment actually does

`vercel.json` in the repo root pins `"framework": "nextjs"` (plus the standard
`npm install` / `next build` commands). This matters because the framework
preset is captured **once at import time**: if the repo was imported before it
contained `package.json` (e.g. when it held only a lone HTML file), the project
is pinned to the *Other* (static) preset — Vercel then never runs `next build`,
creates zero functions, and serves the repo statically, which shows
"This page doesn't exist" for every route. The `vercel.json` override fixes
that on the next push without touching the dashboard.

After the pin, a Vercel deployment builds successfully and serves the full UI
(landing page, views, assets). Every API route that touches the database
responds with a clean **503** explaining that accounts, uploads and builds
need a real server (`DatabaseUnavailableError`, see `src/lib/db.ts`), and the
UI shows a serverless notice banner pointing at this document. No fake data,
no fake builds. Verified locally with `vercel build --prod`: the Build Output
API contains the prerendered landing page, 404/500 pages and one serverless
function per API route. (Running `vercel build` inside the dev sandbox prints
"max function size exceeded" warnings — that is only because the sandbox has
the 1.6 GB `tools/` + `android-sdk/` + `.gradle-home/` toolchain on disk; a
fresh CI clone does not, since those paths are gitignored and provisioned at
runtime by `scripts/sdk-setup.sh`.)

### Where it deploys in one command

Any VPS / cloud VM (Ubuntu 22.04+, 4 GB RAM, 20 GB disk, Docker installed):

```bash
git clone https://github.com/nihadmehar2-gif/Html-to-apk-or-aab.git html2apk
cd html2apk && docker compose up -d --build
# app live on http://<server-ip>:3000 — put Caddy/Nginx in front for HTTPS (see Caddyfile)
```

**Railway / Render / Fly.io** (container platforms with persistent disks — NOT
their serverless products): create the service from the GitHub repo, attach a
persistent volume mounted at `/app/storage` and `/app/db`, set ≥ 4 GB RAM, and
fill in the env vars from §4. The Dockerfile already contains the whole
toolchain, so no extra setup steps are needed.
