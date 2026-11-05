import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* TypeScript errors fail the build (checked: `npm run typecheck` is clean). */
  reactStrictMode: false,
  // NOTE: heavy runtime dirs (android-sdk, tools, .gradle-home, storage) are
  // kept out of the Turbopack file watcher via .gitignore, which Turbopack
  // honors. This protects the sandbox's small inotify budget.
};

export default nextConfig;
