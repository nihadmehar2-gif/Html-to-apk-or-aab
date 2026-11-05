import { z } from 'zod';

/**
 * Android app configuration schema. This is the single source of truth used
 * by the API (validation), the frontend (types) and the build worker.
 */

export const PERMISSION_META = {
  internet: {
    manifest: 'android.permission.INTERNET',
    label: 'Internet',
    why: 'Required to load web content or remote resources (CDNs, APIs, fonts, analytics).',
  },
  camera: {
    manifest: 'android.permission.CAMERA',
    label: 'Camera',
    why: 'Needed only if your website uses <input type="file" capture> or WebRTC getUserMedia video.',
  },
  microphone: {
    manifest: 'android.permission.RECORD_AUDIO',
    label: 'Microphone',
    why: 'Needed only if your website records audio or uses WebRTC getUserMedia audio.',
  },
  location: {
    manifest: 'android.permission.ACCESS_FINE_LOCATION',
    label: 'Location',
    why: 'Needed only if your website uses the Geolocation API.',
  },
  fileAccess: {
    manifest: 'android.permission.READ_EXTERNAL_STORAGE',
    label: 'File access',
    why: 'Legacy storage permission for downloads on Android 9 and older. Not needed for file uploads (the file chooser works without it).',
  },
  notifications: {
    manifest: 'android.permission.POST_NOTIFICATIONS',
    label: 'Notifications',
    why: 'Needed only if your website uses the Web Notifications API.',
  },
} as const;

export type PermissionKey = keyof typeof PERMISSION_META;

export const appConfigSchema = z.object({
  // Basic information
  appName: z.string().trim().min(1, 'Application name is required').max(50, 'Application name must be at most 50 characters'),
  packageName: z.string().trim().min(3).max(100),
  versionName: z.string().trim().regex(/^\d{1,3}(\.\d{1,3}){0,3}$/, 'Version name must look like 1.0'),
  versionCode: z.coerce.number().int().min(1, 'Version code must be >= 1').max(2_100_000_000),
  description: z.string().trim().max(300).optional().default(''),
  language: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Language must be a code like en, zh, pt-BR').default('en'),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Theme color must be hex like #10B981').default('#10B981'),

  // Icon / splash
  iconId: z.string().nullish(),
  splashEnabled: z.boolean().default(true),
  splashColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0F172A'),

  // Screen
  orientation: z.enum(['portrait', 'landscape', 'auto']).default('portrait'),
  fullscreen: z.boolean().default(false),
  statusBarVisible: z.boolean().default(true),
  statusBarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0F172A'),
  navigationBarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0F172A'),
  brightness: z.enum(['system', 'bright']).default('system'),

  // WebView
  javascriptEnabled: z.boolean().default(true),
  domStorageEnabled: z.boolean().default(true),
  databaseEnabled: z.boolean().default(false),
  zoomControls: z.boolean().default(false),
  textZoom: z.coerce.number().int().min(50).max(200).default(100),
  allowFileAccess: z.boolean().default(false),
  externalLinks: z.enum(['external', 'webview', 'ask']).default('external'),
  cacheMode: z.enum(['default', 'noCache', 'offlineFirst']).default('default'),
  mixedContent: z.enum(['never', 'compatibility']).default('never'),
  openFileChooser: z.boolean().default(true),
  downloadsEnabled: z.boolean().default(true),
  userAgentSuffix: z.string().trim().max(120).default(''),

  // Permissions
  permissions: z.object({
    internet: z.boolean().default(true),
    camera: z.boolean().default(false),
    microphone: z.boolean().default(false),
    location: z.boolean().default(false),
    fileAccess: z.boolean().default(false),
    notifications: z.boolean().default(false),
  }).default({ internet: true, camera: false, microphone: false, location: false, fileAccess: false, notifications: false }),

  // Build
  buildType: z.enum(['DEBUG', 'RELEASE']).default('DEBUG'),
  /**
   * What to produce: APK only, AAB only (Google Play), or both artifacts
   * in a single Gradle run. Legacy field `generateAab` is still accepted:
   * when buildTargets is missing, generateAab=true maps to 'BOTH'.
   */
  buildTargets: z.enum(['APK', 'AAB', 'BOTH']).optional(),
  generateAab: z.boolean().optional(), // deprecated — kept for old stored configs
  entryPath: z.string().trim().max(400).optional(),
  releaseKeystoreId: z.string().trim().max(100).nullish(),
});

/** Resolves the build target with backwards compatibility for old configs. */
export function resolveBuildTargets(cfg: { buildTargets?: string | null; generateAab?: boolean | null }): 'APK' | 'AAB' | 'BOTH' {
  if (cfg.buildTargets === 'APK' || cfg.buildTargets === 'AAB' || cfg.buildTargets === 'BOTH') return cfg.buildTargets;
  return cfg.generateAab ? 'BOTH' : 'APK';
}

/** True when the requested targets need a release signing keystore (AAB is always release-signed). */
export function targetsNeedReleaseKeystore(cfg: { buildTargets?: string | null; generateAab?: boolean | null; buildType?: string | null }): boolean {
  return resolveBuildTargets(cfg) !== 'APK' || cfg.buildType === 'RELEASE';
}

export type AppConfig = z.infer<typeof appConfigSchema>;

export const BUILD_STEPS = [
  { key: 'queued', label: 'Queued', progress: 0 },
  { key: 'uploading', label: 'Uploading Files', progress: 5 },
  { key: 'validating', label: 'Validating Project', progress: 12 },
  { key: 'extracting', label: 'Extracting Project', progress: 20 },
  { key: 'preparing', label: 'Preparing Android Project', progress: 30 },
  { key: 'configuring', label: 'Configuring WebView', progress: 38 },
  { key: 'resources', label: 'Generating Android Resources', progress: 45 },
  { key: 'compiling', label: 'Compiling Android Application', progress: 50 },
  { key: 'signing', label: 'Signing Artifacts', progress: 90 },
  { key: 'validatingApk', label: 'Validating Artifacts', progress: 95 },
  { key: 'completed', label: 'Build Completed', progress: 100 },
] as const;

export function stepProgress(step: string): number {
  const found = BUILD_STEPS.find((s) => s.key === step);
  return found ? found.progress : 0;
}
