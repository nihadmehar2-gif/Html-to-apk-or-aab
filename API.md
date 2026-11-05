# HTML2APK Studio — REST API Reference

Base URL: `/api` · Auth: httpOnly JWT cookie `h2a_session` (set by login/register).
All errors return `{ "error": "human readable message" }` with 4xx/5xx status.
Rate limits: auth 15/min · uploads 20/h · builds 10/h · downloads 60/min per user+IP.

---

## Auth

### `POST /api/auth/register`
```json
{ "email": "user@example.com", "password": "min-8-chars", "name": "Ada" }
```
`200` → `{ "user": { "id", "email", "name", "role" } }` · `409` email exists

### `POST /api/auth/login`
```json
{ "email": "demo@html2apk.studio", "password": "demo1234" }
```
`200` → `{ "user": … }` · `401` bad credentials (uniform message) · `403` suspended

### `POST /api/auth/logout` → `{ "ok": true }`

### `GET /api/auth/me` → `{ "user": { … } | null }`

### `PATCH /api/auth/me`
```json
{ "name": "New Name", "currentPassword": "…", "newPassword": "min-8-chars" }
```
All fields optional; password change requires the current password.

---

## Uploads

### `POST /api/uploads`  (multipart/form-data)
| field | value |
| --- | --- |
| `file` | `.html`/`.htm` (≤20 MB markup-validated) or `.zip` project (≤50 MB, ≤3000 entries, ≤400 MB decompressed) |

Response `200`:
```json
{
  "projectId": "…", "uploadId": "…", "filename": "site.zip", "kind": "ZIP",
  "analysis": {
    "fileCount": 12, "totalBytes": 83421,
    "entryPath": "index.html", "entryCandidates": ["index.html"],
    "htmlFiles": ["index.html", "about.html"],
    "externalHosts": ["cdn.example.com", "fonts.googleapis.com"],
    "assetSummary": { "html": 2, "css": 1, "javascript": 1, "images": 6 },
    "warnings": ["This project references 2 external hosts (…). Internet permission is recommended…"]
  }
}
```
Errors: `413` too large · `415` unsupported/invalid markup · `400` corrupted or unsafe ZIP
(path traversal, absolute paths, reserved names).

### `POST /api/uploads/icon` (multipart) — `file`: PNG/JPEG/WebP ≥48×48, ≤5 MB → `{ "iconId": "…" }`

---

## Keystores (release signing)

### `GET /api/keystores` → `{ "keystores": [ { "id", "alias", "commonName", "organization", "createdAt" } ] }`

### `POST /api/keystores` — JSON (generate)
```json
{ "mode": "generate", "alias": "release-key", "password": "min-6-chars",
  "commonName": "Your Name", "organization": "Company" }
```
→ RSA-2048 keystore, 30-year validity. Passwords AES-256-GCM encrypted at rest.

### `POST /api/keystores` — multipart (upload existing)
`file` (.jks/.keystore ≤1 MB) + `alias` + `password` (+ optional `keyPassword`).
Validated with `keytool -list` before saving; wrong password → `400`.

### `DELETE /api/keystores/:id` — owner only; removes record + file.

> Passwords are never returned by the API, never written to logs, and only decrypted
> in memory by the build worker for Gradle signing.

---

## Builds

### `POST /api/builds`
```json
{
  "projectId": "…",
  "config": {
    "appName": "My Web App",
    "packageName": "com.example.mywebapp",
    "versionName": "1.0", "versionCode": 1,
    "description": "", "language": "en", "themeColor": "#10B981",
    "iconId": null, "splashEnabled": true, "splashColor": "#0F172A",
    "orientation": "portrait", "fullscreen": false, "statusBarVisible": true,
    "statusBarColor": "#0F172A", "navigationBarColor": "#0F172A", "brightness": "system",
    "javascriptEnabled": true, "domStorageEnabled": true, "databaseEnabled": false,
    "zoomControls": false, "textZoom": 100, "allowFileAccess": true,
    "externalLinks": "external", "cacheMode": "default", "mixedContent": "never",
    "openFileChooser": true, "downloadsEnabled": true, "userAgentSuffix": "",
    "permissions": { "internet": true, "camera": false, "microphone": false,
                     "location": false, "fileAccess": false, "notifications": false },
    "buildType": "DEBUG",
    "generateAab": false,
    "entryPath": "index.html",
    "releaseKeystoreId": null
  }
}
```
`201` → `{ "buildId": "…", "status": "QUEUED" }`
Errors: `400` invalid package/version/colors, release without keystore · `404` project not owned ·
`422` entry HTML missing (`{ "needsEntrySelection": true, "htmlFiles": [...] }`).

### `GET /api/builds` — user's builds (latest 60) with project info.

### `GET /api/builds/:id`
```json
{ "build": {
  "id": "…", "status": "RUNNING", "step": "Compiling Android Application",
  "progress": 68, "buildType": "DEBUG", "appName": "…", "packageName": "…",
  "versionName": "1.0", "versionCode": 1, "apkSize": null, "aabSize": null,
  "hasApk": false, "hasAab": false, "errorMessage": null,
  "createdAt": "…", "finishedAt": null, "expiresAt": "…", "downloadCount": 0,
  "config": { … }, "project": { "id": "…", "name": "…", "sourceType": "ZIP" }
} }
```
Statuses: `QUEUED → RUNNING → SUCCEEDED | FAILED | CANCELLED` (later `EXPIRED`).
Polling this endpoint also runs the janitor (stale-worker detection, retention, queue pump).

### `GET /api/builds/:id/logs?offset=0`
Incremental log bytes: `{ "chunk": "…", "total": 15230, "offset": 15230 }`.
Send back the returned `offset` to stream logs (poll every ~2 s).

### `POST /api/builds/:id/retry` — clone config into a fresh queued build → `{ "buildId": "…" }`
### `POST /api/builds/:id/cancel` — mark cancelled + SIGTERM the worker process tree
### `DELETE /api/builds/:id` — delete record + artifacts + logs (owner; not while running)

### `GET /api/builds/:id/download?type=apk|aab|logs`
Checks: owner-or-admin · status `SUCCEEDED` · not expired · file exists & non-empty.
Headers: `Content-Type: application/vnd.android.package-archive` (apk),
`Content-Disposition: attachment; filename="<App>-v<version>-<type>.apk"`.
Every download increments `downloadCount` and writes a DownloadLog row.
Errors: `409` not finished · `410` expired · `404` no AAB.

---

## System

### `GET /api/system/health` (public)
```json
{ "ok": true, "engineReady": true, "queue": { "running": 0, "queued": 0, "maxConcurrent": 1 }, "version": "1.0.0" }
```

---

## Admin (role=ADMIN only; 401 anonymous, 403 non-admin)

### `GET /api/admin/stats`
Totals (users/projects/succeeded/failed/active/downloads), storage bytes per category,
disk free, platform limits, 10 most recent builds with owner emails.

### `GET /api/admin/builds?status=all|QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELLED|EXPIRED`
### `GET /api/admin/users` — users + project/build counts
### `PATCH /api/admin/users/:id` — `{ "action": "suspend" | "activate" | "promote" | "demote" }`
### `DELETE /api/admin/users/:id` — deletes user + all projects/builds/artifacts/keystores
### `GET /api/admin/system` — build-engine tool checks (sdk/build-tools/platform/gradle/java/template),
active jobs with progress, workspace count, machine info (cpus, load, memory, uptime)

---

## cURL example (full flow)

```bash
B=http://localhost:3000
curl -c jar -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@html2apk.studio","password":"demo1234"}'
PID=$(curl -sb jar -F file=@site.zip $B/api/uploads | jq -r .projectId)
BID=$(curl -sb jar -X POST $B/api/builds -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PID\",\"config\":{\"appName\":\"Site\",\"packageName\":\"com.x.site\",\"versionName\":\"1.0\",\"versionCode\":1,\"buildType\":\"DEBUG\",\"entryPath\":\"index.html\"}}" | jq -r .buildId)
watch -n2 "curl -sb jar $B/api/builds/$BID | jq -c '.build | {status, step, progress}'"
curl -sb jar -o app.apk "$B/api/builds/$BID/download?type=apk"
```
