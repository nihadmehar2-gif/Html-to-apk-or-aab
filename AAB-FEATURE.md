# AAB (Android App Bundle) Generation — Feature Guide

HTML2APK Studio now supports **three build targets** for every project:

| Target | What you get | Gradle task | Signing |
| --- | --- | --- | --- |
| **Build APK** | Installable `.apk` (Debug or Release variant) | `assembleDebug` / `assembleRelease` | debug keystore (auto) or your release keystore |
| **Build AAB** | `.aab` for Google Play upload | `bundleRelease` | **always** your release keystore |
| **Build Both** | APK + AAB from one Gradle run | e.g. `assembleDebug` + `bundleRelease` | APK per chosen variant, AAB release-signed |

The existing APK pipeline is untouched — selecting **Build APK** behaves exactly as before.

---

## 1. How it works

- A new config field `buildTargets: 'APK' | 'AAB' | 'BOTH'` selects the artifact set.
  Legacy configs that only had `generateAab: true` keep working (mapped to `BOTH`).
- AAB is **always built in release mode** with the `bundleRelease` task and signed with
  the user's release keystore — Google Play rejects unsigned/debug bundles. This means
  every target that includes an AAB requires a configured keystore (enforced in both
  the UI and the API).
- APK and AAB share the **same `defaultConfig`** in the generated `app/build.gradle`,
  so `package name`, `versionCode` and `versionName` are identical for both artifacts
  by construction — and verified after the build (see below).

### Post-build verification (every build)

| Artifact | Checks |
| --- | --- |
| APK | ZIP structure (manifest + dex + assets/www) · `apksigner verify` · `aapt2 dump badging` → package/versionCode/versionName must match the request |
| AAB | ZIP structure (`BundleConfig.pb` + `base/manifest/AndroidManifest.xml`) · `jarsigner -verify` (release-signature proof) · `bundletool dump manifest` → package/versionCode/versionName must match the request (and the APK, when both are built) |

A build that fails any check is marked **FAILED** and no artifact is published —
nothing broken is ever downloadable.

---

## 2. Modified files

| File | Change |
| --- | --- |
| `src/lib/app-config.ts` | Added `buildTargets` to the zod schema + `resolveBuildTargets()` / `targetsNeedReleaseKeystore()` helpers (legacy `generateAab` mapping); neutral step labels |
| `src/components/studio/types.ts` | `buildTargets` added to `AppConfigForm` + `DEFAULT_CONFIG` |
| `scripts/build-worker.mjs` | Target-aware Gradle task list; debug **and** release signing configs can coexist (BOTH + Debug APK + release AAB); AAB-only builds no longer hard-fail (`results.apk` requirement removed); AAB verification with `jarsigner` + `bundletool` + identity checks; APK version identity check; step keys aligned with the UI |
| `src/app/api/builds/route.ts` | Release-keystore enforcement for any target that includes an AAB; resolved `buildTargets` stored in `configJson` |
| `src/components/studio/config-view.tsx` | New **"What do you want to build?"** 3-option selector; APK variant selector hidden for AAB-only; keystore manager shown whenever needed; dynamic Build button label |
| `src/components/studio/dashboard-view.tsx` | **AAB size column**; target badges (APK / AAB / APK + AAB); quick APK/AAB download icon buttons (visible on mobile too) |
| `src/components/studio/result-view.tsx` | Adaptive headline ("Your AAB is ready 🎉" / "Your APK + AAB are ready 🎉"), AAB-first download button, Play-Upload footer for AAB-only builds |
| `src/components/studio/build-view.tsx` | Pipeline step labels are artifact-neutral; success banner adapts |
| `scripts/sdk-setup.sh` | Downloads the official **bundletool** jar (`tools/bundletool.jar`) for AAB verification |
| `scripts/test-build.mjs` | Accepts `--targets APK\|AAB\|BOTH` for direct worker tests |
| `scripts/e2e-tests.mjs` | New **Test 8**: build targets matrix over HTTP (AAB-only, keystore enforcement, legacy compat, bundletool identity) |

No database migration is needed — `Build.aabPath` / `Build.aabSize` already existed and
`buildTargets` lives inside the `configJson` snapshot.

---

## 3. Setup instructions

### Fresh environment

```bash
# 1. Install the toolchain (Gradle 8.11.1, JDK 21, Android SDK 36, bundletool)
bash scripts/sdk-setup.sh

# 2. Environment variables (.env — see .env.example for all options)
DATABASE_URL=file:./db/custom.db
H2A_ANDROID_SDK=/home/z/my-project/android-sdk
H2A_GRADLE_BIN=/home/z/my-project/tools/gradle-8.11.1/bin/gradle
H2A_GRADLE_USER_HOME=/home/z/my-project/.gradle-home
H2A_JAVA_HOME=/home/z/my-project/tools/jdk-21
H2A_BUILD_TOOLS=36.0.0
# Optional overrides:
# H2A_BUNDLETOOL_JAR=/path/to/bundletool.jar   (default: tools/bundletool.jar)
# H2A_MAX_CONCURRENT_BUILDS=1, H2A_BUILD_TIMEOUT_MIN=25, H2A_RETENTION_DAYS=7

# 3. Database + run
npm install
npx prisma generate && npx prisma db push
npm run dev          # development
# npm run build && npm start   # production
```

The worker locates bundletool automatically: `H2A_BUNDLETOOL_JAR` env → `tools/bundletool.jar`
→ Gradle dependency cache. If it cannot be found, AAB builds still pass (structure +
jarsigner checks run regardless) and only the bundle identity *dump* is skipped with a
log note.

### Using the feature (UI)

1. Upload an HTML file or ZIP project.
2. On the **Configure** page, under **Build target & signing**, pick
   **Build APK**, **Build AAB**, or **Build Both**.
3. For AAB / Both: generate or upload a release keystore (it appears as soon as the
   target needs one).
4. Press **Build AAB** / **Build APK + AAB**. Watch the pipeline; when it finishes the
   result page offers the APK and/or AAB download with sizes, and the dashboard shows
   an **AAB size** column with quick download buttons.

### Using the feature (API)

```bash
curl -X POST http://localhost:3000/api/builds \
  -H 'Content-Type: application/json' -b 'your-session-cookie' \
  -d '{
    "projectId": "<your-project-id>",
    "config": {
      "appName": "My App",
      "packageName": "com.example.myapp",
      "versionName": "1.0.0",
      "versionCode": 1,
      "buildType": "DEBUG",          // variant of the APK (AAB is always release)
      "buildTargets": "AAB",         // "APK" | "AAB" | "BOTH"
      "releaseKeystoreId": "<keystore-id>",   // required when AAB is included
      "entryPath": "index.html",
      ...                            // rest of the standard config
    }
  }'
# poll GET /api/builds/<id> until SUCCEEDED, then:
#   GET /api/builds/<id>/download?type=aab
#   GET /api/builds/<id>/download?type=apk   (only when APK/BOTH was built)
```

---

## 4. Google Play notes

- The `.aab` produced here is signed with your **upload key**. Play re-signs with the
  app signing key after upload — this is the standard flow.
- Keep the keystore + passwords safe: every future bundle must be signed with the same
  upload key. The platform stores passwords AES-256-GCM encrypted and never logs them.
- First Play upload also requires store listing assets (screenshots, privacy policy…)
  which are outside the scope of this tool.
