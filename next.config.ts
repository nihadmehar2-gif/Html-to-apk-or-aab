import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted (Docker/VPS) runs a standalone server via `npm run build:standalone`;
  // on Vercel the platform builder consumes the regular .next output, so the
  // standalone mode is disabled there (VERCEL is set during its builds/runtime).
  output: process.env.VERCEL ? undefined : "standalone",
  /* TypeScript errors fail the build (checked: `npm run typecheck` is clean). */
  reactStrictMode: false,
  // NOTE: heavy runtime dirs (android-sdk, tools, .gradle-home, storage) are
  // kept out of the Turbopack file watcher via .gitignore, which Turbopack
  // honors. This protects the sandbox's small inotify budget.
};

export default nextConfig;
