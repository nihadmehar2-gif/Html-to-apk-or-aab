#!/bin/bash
# Builds a sanitized distribution ZIP of HTML2APK Studio.
# Excludes ALL secrets, credentials, user data and machine artifacts:
#   .env* (real), db/, storage/ (keystores, artifacts, uploads, .h2a_secret),
#   tools/ (JDK), android-sdk/, .gradle-home/, node_modules/, .next/,
#   download/, upload/, logs, sandbox-only dirs.
# Ships .env.example as the configuration template.
set -euo pipefail
BASE=/home/z/my-project
OUT=$BASE/download/html2apk-studio-dist.zip
STAGE=/tmp/h2a-dist

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"
cd "$BASE"

# --- copy the source tree with a strict exclude list ---
rsync -a \
  --exclude '.env' --exclude '.env.local' --exclude '.env.production' \
  --exclude 'db/' --exclude 'storage/' \
  --exclude 'tools/' --exclude 'android-sdk/' --exclude '.gradle-home/' \
  --exclude 'node_modules/' --exclude '.next/' \
  --exclude 'download/' --exclude 'upload/' \
  --exclude 'skills/' --exclude 'tool-results/' --exclude '.agent-browser/' \
  --exclude '*.log' --exclude 'dev.out.log' \
  --exclude '.z-ai-config' --exclude '.claude' \
  "$BASE/" "$STAGE/"

# --- safety: assert no secret material made it in ---
if find "$STAGE" -name '*.jks' -o -name '*.keystore' -o -name '.h2a_secret' -o -name 'custom.db' -o -name '.env' | grep -q .; then
  echo "FATAL: secret material found in staging:" >&2
  find "$STAGE" -name '*.jks' -o -name '*.keystore' -o -name '.h2a_secret' -o -name 'custom.db' -o -name '.env'
  exit 1
fi
if grep -rIl "demo@html2apk.studio" "$STAGE" --include='*.ts' --include='*.tsx' | grep -q seed.ts; then
  echo "note: seed.ts still references demo account (code, gated by env) — OK"
fi

# --- zip it ---
mkdir -p "$BASE/download"
( cd "$STAGE" && zip -qr "$OUT" . )
rm -rf "$STAGE"

echo "dist created: $OUT"
unzip -l "$OUT" | tail -1
sha256sum "$OUT"
