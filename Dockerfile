# ---------- HTML2APK Studio production image ----------
# Includes the full Android build toolchain: Temurin JDK 21, Android SDK
# (cmdline-tools + platform-tools + build-tools 36.0.0 + platform android-36)
# and Gradle 8.11.1. Image size ≈ 4 GB — this is a build server, not a static site.

FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip ca-certificates git python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# ---- JDK 21 (Temurin) ----
RUN mkdir -p /opt/java && \
    curl -sSL -o /tmp/jdk.tar.gz \
      "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" && \
    tar xzf /tmp/jdk.tar.gz -C /opt/java --strip-components=1 && rm /tmp/jdk.tar.gz
ENV JAVA_HOME=/opt/java
ENV PATH="$JAVA_HOME/bin:${PATH}"

# ---- Android SDK ----
ENV ANDROID_HOME=/opt/android-sdk
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && \
    curl -sSL -o /tmp/clt.zip \
      https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip && \
    unzip -q /tmp/clt.zip -d ${ANDROID_HOME}/cmdline-tools && \
    mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm /tmp/clt.zip
RUN yes | ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_HOME} --licenses > /dev/null && \
    yes | ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_HOME} \
      "platform-tools" "build-tools;36.0.0" "platforms;android-36" > /dev/null

# ---- Gradle 8.11.1 ----
RUN curl -sSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.11.1-bin.zip && \
    unzip -q /tmp/gradle.zip -d /opt && rm /tmp/gradle.zip
ENV GRADLE_HOME=/opt/gradle-8.11.1

# ---- Application ----
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate

ENV H2A_ANDROID_SDK=/opt/android-sdk \
    H2A_JAVA_HOME=/opt/java \
    H2A_GRADLE_BIN=/opt/gradle-8.11.1/bin/gradle \
    H2A_GRADLE_USER_HOME=/root/.gradle \
    H2A_ROOT=/app \
    H2A_MAVEN_MIRROR=standard \
    NODE_ENV=production

RUN npm run build:standalone

EXPOSE 3000
CMD ["npm", "run", "start"]
