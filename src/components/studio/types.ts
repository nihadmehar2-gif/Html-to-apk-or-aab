export type User = {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
};

export type Analysis = {
  kind: 'HTML' | 'ZIP';
  fileCount: number;
  totalBytes: number;
  entryPath: string | null;
  entryCandidates: string[];
  htmlFiles: string[];
  externalHosts: string[];
  assetSummary: Record<string, number>;
  warnings: string[];
};

export type UploadResult = {
  projectId: string;
  uploadId: string;
  filename: string;
  kind: 'HTML' | 'ZIP';
  analysis: Analysis;
};

export type AppConfigForm = {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  description: string;
  language: string;
  themeColor: string;
  iconId: string | null;
  splashEnabled: boolean;
  splashColor: string;
  orientation: 'portrait' | 'landscape' | 'auto';
  fullscreen: boolean;
  statusBarVisible: boolean;
  statusBarColor: string;
  navigationBarColor: string;
  brightness: 'system' | 'bright';
  javascriptEnabled: boolean;
  domStorageEnabled: boolean;
  databaseEnabled: boolean;
  zoomControls: boolean;
  textZoom: number;
  allowFileAccess: boolean;
  externalLinks: 'external' | 'webview' | 'ask';
  cacheMode: 'default' | 'noCache' | 'offlineFirst';
  mixedContent: 'never' | 'compatibility';
  openFileChooser: boolean;
  downloadsEnabled: boolean;
  userAgentSuffix: string;
  permissions: {
    internet: boolean;
    camera: boolean;
    microphone: boolean;
    location: boolean;
    fileAccess: boolean;
    notifications: boolean;
  };
  buildType: 'DEBUG' | 'RELEASE';
  /** What to produce: APK only, AAB only (Play Store), or both artifacts. */
  buildTargets: 'APK' | 'AAB' | 'BOTH';
  /** @deprecated legacy flag — superseded by buildTargets */
  generateAab: boolean;
  entryPath: string;
  releaseKeystoreId: string | null;
};

export const DEFAULT_CONFIG: AppConfigForm = {
  appName: 'My Web App',
  packageName: 'com.example.mywebapp',
  versionName: '1.0',
  versionCode: 1,
  description: '',
  language: 'en',
  themeColor: '#10B981',
  iconId: null,
  splashEnabled: true,
  splashColor: '#0F172A',
  orientation: 'portrait',
  fullscreen: false,
  statusBarVisible: true,
  statusBarColor: '#0F172A',
  navigationBarColor: '#0F172A',
  brightness: 'system',
  javascriptEnabled: true,
  domStorageEnabled: true,
  databaseEnabled: false,
  zoomControls: false,
  textZoom: 100,
  allowFileAccess: true,
  externalLinks: 'external',
  cacheMode: 'default',
  mixedContent: 'never',
  openFileChooser: true,
  downloadsEnabled: true,
  userAgentSuffix: '',
  permissions: {
    internet: true,
    camera: false,
    microphone: false,
    location: false,
    fileAccess: false,
    notifications: false,
  },
  buildType: 'DEBUG',
  buildTargets: 'APK',
  generateAab: false,
  entryPath: '',
  releaseKeystoreId: null,
};

export type BuildRow = {
  id: string;
  projectId: string;
  userId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  buildType: 'DEBUG' | 'RELEASE';
  step: string;
  progress: number;
  versionName: string;
  versionCode: number;
  packageName: string;
  appName: string;
  errorMessage: string | null;
  apkSize: number | null;
  aabSize: number | null;
  hasApk: boolean;
  hasAab: boolean;
  downloadCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  config?: AppConfigForm & Record<string, unknown>;
  project?: { id: string; name: string; sourceType: string; originalName: string };
  user?: { email: string } | null;
};

export type KeystoreRow = {
  id: string;
  alias: string;
  commonName: string | null;
  organization: string | null;
  createdAt: string;
};

export const PERMISSION_INFO: { key: keyof AppConfigForm['permissions']; label: string; why: string }[] = [
  { key: 'internet', label: 'Internet', why: 'Required to load web content or remote resources (CDNs, APIs, fonts). Without it, only fully offline projects will work.' },
  { key: 'camera', label: 'Camera', why: 'Needed only if your website uses <input type="file" capture> or WebRTC camera (getUserMedia video).' },
  { key: 'microphone', label: 'Microphone', why: 'Needed only if your website records audio or uses WebRTC microphone.' },
  { key: 'location', label: 'Location', why: 'Needed only if your website uses the browser Geolocation API.' },
  { key: 'fileAccess', label: 'File access', why: 'Needed to save downloads on Android 9 and below. File picking works without it via the system picker.' },
  { key: 'notifications', label: 'Notifications', why: 'Needed only if your website uses the Web Notifications API.' },
];

export function formatBytes(n?: number | null): string {
  if (n == null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export const STATUS_STYLES: Record<string, string> = {
  QUEUED: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  RUNNING: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  SUCCEEDED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  FAILED: 'bg-red-500/10 text-red-500 border-red-500/30',
  CANCELLED: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30',
  EXPIRED: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};
