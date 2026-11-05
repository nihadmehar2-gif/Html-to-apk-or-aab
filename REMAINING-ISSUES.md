# HTML2APK Studio — Remaining Issues (honest disclosure)

Everything below is **known and disclosed**, not hidden. Items 1–2 require a
device/emulator or external services this sandbox does not have; the rest are
scoped follow-ups.

## 1. Android runtime NOT TESTED (device/emulator)

This sandbox has **no Android emulator or physical device**. The generated apps
compile, sign and pass structural verification, but nobody has pressed a button
inside them on real hardware. Before trusting the WebView behavior changes
(WebViewAssetLoader origin, edge-to-edge insets, blob downloads), run this
10-minute checklist on any device with Android 7+:

1. Install `app-debug.apk` → app opens to your page (not the error page).
2. Open a page using root-relative assets (`/css/style.css`) → styles load.
3. Page with `<script type="module">` → module executes.
4. Use `localStorage` → reload the app → data persists.
5. Rotate the device / hide-show keyboard → content not hidden behind system bars
   (test on Android 15+ if available).
6. Tap an external `https://` link → opens in the browser (or per your policy).
7. Tap `mailto:` / `tel:` → correct app opens.
8. `<input type=file>` → chooser opens; with camera permission, camera option works.
9. Trigger a download (http) → file lands in Downloads; blob-download (canvas
   export) → saved with toast.
10. Press system back through history → exits only after history is exhausted.
11. Airplane mode → offline error page shows; disable → page reloads.
12. Release APK: signature dialog shows "unknown developer" (expected for
    self-signed keys).

## 2. AAB signature verification — RESOLVED (2026-11-05)

`bundletool.jar` is now provisioned by `scripts/sdk-setup.sh` (auto-healed by the
build worker when missing). Every release build verifies AABs with
`jarsigner -verify` (proof of release-keystore signature) AND
`bundletool dump manifest` (package/versionCode/versionName identity checked
against the request and the APK). Verified end-to-end with a real
`RELEASE --targets BOTH` run: APK 2.47 MB + AAB 2.37 MB, both identity-matched.

## 3. Scoped follow-ups (non-blocking)

- **Parallel build load**: `H2A_MAX_CONCURRENT_BUILDS > 1` works (atomic claims),
  but Gradle memory (`-Xmx1536m`) is tuned for 4 GB boxes — raise with RAM.
- **Rate limits** are in-memory per process — multi-instance deployments should
  move them to Redis or the DB.
- **SQLite** is fine for a single box; for clustered deployments switch the
  Prisma datasource to Postgres (schema is portable).
- **Demo credentials** (`demo@html2apk.studio / demo1234`) remain active in this
  sandbox by design; production installs skip demo seeding unless
  `H2A_SEED_DEMO=true`. The admin password can/should be overridden with
  `H2A_SEED_ADMIN_PASSWORD` — in this sandbox the seeded default remains, as the
  deployment is a demo environment.
- **Seed migration for old databases**: databases created before this fix that
  contain the sample project get `original.zip` written on upgrade (done in this
  environment); brand-new installs create it automatically.
- **Log rotation**: build logs are per-build files cleaned by retention; the
  Next.js `dev.log`/`server.log` are unrotated (stdout in production).

## 4. Play Store review

Toolchain (targetSdk 36, AAB, signing) matches the Nov 2026 Play requirements.
Review acceptance additionally depends on the app's own content/policies
(privacy policy, data-safety form) which are per-user responsibilities — the
platform cannot guarantee review outcomes.
