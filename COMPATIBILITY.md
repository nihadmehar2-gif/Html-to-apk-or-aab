# HTML2APK Studio — Compatibility Checklist (final toolchain)

**Release date:** 2026-11-05

## Build toolchain (installed by `scripts/sdk-setup.sh`)

| Component | Version | Rationale |
| --- | --- | --- |
| Temurin JDK | **21.0.13** (full JDK, has `javac`) | Required by AGP 8.9; LTS |
| Android Gradle Plugin | **8.9.2** | First stable line that officially compiles API 36 |
| Gradle | **8.11.1** | Minimum for AGP 8.9.x (`8.11.1` per AGP compatibility table) |
| Android SDK platform | **android-36** (`platform-36_r02`) | Android 16 |
| Android build-tools | **36.0.0** | Matches platform 36 |
| cmdline-tools | 11076708 (latest) | sdkmanager |
| platform-tools | 37.0.1 | adb/fastboot (not used in builds, installed for completeness) |

## Generated Android apps

| Item | Value | Notes |
| --- | --- | --- |
| compileSdk | **36** | `aapt2 dump badging`: `compileSdkVersion='36'` |
| targetSdk | **36** | Meets Google Play target-API policy (36 required for updates by Aug 2026) |
| minSdk | 24 | Android 7.0+ |
| applicationId | user-configured | reverse-domain, Java-keyword-checked |
| Java compatibility | VERSION_17 | javac target |
| Kotlin stdlib | forced 1.8.22 (all three artifacts) | Fixes androidx duplicate-class classpath error |
| androidx.appcompat | 1.7.1 | compileSdk 36 compatible |
| androidx.webkit | 1.14.0 | WebViewAssetLoader (secure asset origin) |
| Edge-to-edge | Insets-driven layout + runtime scrims | Correct on API 24–36 incl. Android 15/16 enforcement |

## WebView runtime behavior

| Capability | Status |
| --- | --- |
| Content origin | `https://appassets.androidplatform.net/assets/www/` (WebViewAssetLoader) |
| Root-relative paths (`/img/x.png`) | work (real origin) |
| ES modules (`<script type="module">`) | work (same-origin https) |
| fetch / XHR to same origin | work (secure origin, no CORS violation) |
| localStorage / IndexedDB | work (DOM storage enabled by default) |
| External links | policy: open in browser / in app / ask |
| `mailto:`/`tel:`/`sms:`/`geo:`/`market:` | open external app |
| `intent://` | parsed via `Intent.parseUri` + browser_fallback_url |
| Back button | WebView history first, then app exit |
| `<input type=file>` | file chooser + camera capture via FileProvider |
| Downloads (http/https) | DownloadManager (+ legacy permission flow ≤ Android 9) |
| Downloads (blob:) | `H2ABlob` bridge → MediaStore Downloads |
| WebRTC camera/mic | permission bridge, gated by configured permissions |
| Geolocation | gated by configured permission |
| JS alert/confirm/prompt | native dialogs |

## Verification status

- Debug APK, signed release APK and AAB **really compiled and verified** in this
  environment (see TEST-REPORT.md).
- Runtime behavior on a physical Android device/emulator: **NOT TESTED** — this
  sandbox has no Android emulator. See REMAINING-ISSUES.md for the manual checklist.
