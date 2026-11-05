#!/bin/bash
# Installs the full Android build toolchain INSIDE the project directory so it
# survives sandbox restarts. Self-contained: downloads everything it needs.
#   - Gradle 8.11.1        -> $BASE/tools/gradle-8.11.1
#   - Android SDK          -> $BASE/android-sdk
#     (cmdline-tools, platform-tools, platforms;android-36, build-tools;36.0.0)
# inotify safety: Gradle runs with org.gradle.vfs.watch=false (see gradle.properties
# in android-template) so it never exhausts the 8192-watch budget needed by next dev.
set -e
BASE=/home/z/my-project
SDK=$BASE/android-sdk
TOOLS=$BASE/tools
M=https://mirrors.cloud.tencent.com
G=https://dl.google.com/android/repository

mkdir -p "$SDK/build-tools" "$SDK/platforms" "$SDK/licenses" "$TOOLS"

dl() { # dl <output> <url> <fallback-url>
  local out=$1 url=$2 fb=$3
  if [ -s "$out" ]; then echo "[dl] $out already present"; return 0; fi
  curl -fsSL --retry 2 -o "$out" "$url" || curl -fsSL --retry 2 -o "$out" "$fb"
}

echo "[1/6] Gradle 8.11.1..."
dl /tmp/gradle.zip "$M/gradle/gradle-8.11.1-bin.zip" "https://services.gradle.org/distributions/gradle-8.11.1-bin.zip"
if [ ! -d "$TOOLS/gradle-8.11.1" ]; then
  cd "$TOOLS" && unzip -qo /tmp/gradle.zip
fi
"$TOOLS/gradle-8.11.1/bin/gradle" --version 2>&1 | grep -E "Gradle|JVM:" | head -3 || true

echo "[1b/6] Temurin JDK 21 (javac)..."
if [ ! -x "$TOOLS/jdk-21/bin/javac" ]; then
  dl /tmp/jdk21.tar.gz "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" \
    "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_linux_hotspot_21.0.5_11.tar.gz"
  tar xzf /tmp/jdk21.tar.gz -C "$TOOLS"
  JDKDIR=$(find "$TOOLS" -maxdepth 1 -type d -name 'jdk-21*' | head -1)
  [ -n "$JDKDIR" ] && [ "$JDKDIR" != "$TOOLS/jdk-21" ] && mv "$JDKDIR" "$TOOLS/jdk-21"
fi
"$TOOLS/jdk-21/bin/javac" -version

echo "[1c/6] bundletool (AAB verification) -> $TOOLS/bundletool.jar..."
if [ ! -s "$TOOLS/bundletool.jar" ]; then
  dl "$TOOLS/bundletool.jar" "https://github.com/google/bundletool/releases/download/1.17.2/bundletool-all-1.17.2.jar" \
    "https://github.com/google/bundletool/releases/download/1.18.0/bundletool-all-1.18.0.jar"
fi
"$TOOLS/jdk-21/bin/java" -jar "$TOOLS/bundletool.jar" help > /dev/null 2>&1 && echo "bundletool OK ($(du -h "$TOOLS/bundletool.jar" | cut -f1))" || echo "WARN: bundletool check failed (AAB identity dump will be skipped)"

echo "[2/6] SDK packages (dl.google.com official repository)..."
dl /tmp/clt.zip "$G/commandlinetools-linux-11076708_latest.zip" "$M/AndroidSDK/commandlinetools-linux-11076708_latest.zip"
dl /tmp/bt36.zip "$G/build-tools_r36_linux.zip" "$M/AndroidSDK/build-tools_r36_linux.zip"
dl /tmp/plat36.zip "$G/platform-36_r02.zip" "$M/AndroidSDK/platform-36_r02.zip"
dl /tmp/ptools.zip "$G/platform-tools_r37.0.1-linux.zip" "$M/AndroidSDK/platform-tools-latest-linux.zip"
ls -la /tmp/clt.zip /tmp/bt36.zip /tmp/plat36.zip /tmp/ptools.zip

echo "[3/6] Unpacking..."
cd /tmp
unzip -qo clt.zip -d clt-x && rm -rf "$SDK/cmdline-tools" && mkdir -p "$SDK/cmdline-tools" && mv clt-x/cmdline-tools "$SDK/cmdline-tools/latest" && rm -rf clt-x
unzip -qo bt36.zip -d bt-x && rm -rf "$SDK/build-tools/36.0.0" && mv bt-x/* "$SDK/build-tools/36.0.0" 2>/dev/null || { mkdir -p "$SDK/build-tools/36.0.0" && mv bt-x/* "$SDK/build-tools/36.0.0"; }; rm -rf bt-x
unzip -qo plat36.zip -d plat-x && ls plat-x && rm -rf "$SDK/platforms/android-36" && mkdir -p "$SDK/platforms" && mv plat-x/* "$SDK/platforms/" && rm -rf plat-x
# platform zip may extract as android-16 (API level dir naming) -> normalize
if [ -d "$SDK/platforms/android-16" ] && [ ! -d "$SDK/platforms/android-36" ]; then mv "$SDK/platforms/android-16" "$SDK/platforms/android-36"; fi
rm -rf "$SDK/platform-tools" ptools-x && mkdir ptools-x && unzip -qo ptools.zip -d ptools-x && mv ptools-x/platform-tools "$SDK/platform-tools" && rm -rf ptools-x

echo "[4/6] SDK licenses..."
cat > "$SDK/licenses/android-sdk-license" << 'EOF'
8933bad161af4178b1185d1a37fbf41ea5269c55
d56f5187479451eabf01fb78af6dfcb131a6481e
24333f8a63b6825ea9c5514f83c2829b004d1fee
EOF
cat > "$SDK/licenses/android-sdk-preview-license" << 'EOF'
84831b9409646a918e30573bab4c9c91346d8abd
EOF

echo "[5/6] Permissions..."
chmod -R u+x "$SDK/build-tools/36.0.0" "$SDK/platform-tools" "$SDK/cmdline-tools" 2>/dev/null || true
find "$SDK" -maxdepth 4 \( -name aapt2 -o -name aapt -o -name zipalign -o -name apksigner -o -name d8 \) -exec chmod +x {} \; 2>/dev/null || true

echo "[6/6] Verify..."
"$SDK/build-tools/36.0.0/aapt2" version 2>&1 || echo "WARN: aapt2 version failed"
test -f "$SDK/platforms/android-36/android.jar" && echo "android.jar OK ($(du -h "$SDK/platforms/android-36/android.jar" | cut -f1))"
"$TOOLS/gradle-8.11.1/bin/gradle" --version 2>&1 | grep -E "Gradle|JVM:" | head -3
echo "SDK_SETUP_COMPLETE"
