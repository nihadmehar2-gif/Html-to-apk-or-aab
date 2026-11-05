'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Upload, Smartphone, MonitorSmartphone, SlidersHorizontal, ShieldCheck,
  KeyRound, Image as ImageIcon, Check, Plus, Trash2, Lock, AlertCircle, AlertTriangle, Info, FileArchive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from './api';
import { PERMISSION_INFO, formatBytes, type AppConfigForm, type KeystoreRow, type UploadResult } from './types';

const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]{1,})+$/;
const JAVA_KEYWORDS = new Set(['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while','true','false','null']);

function defaultConfig(upload: UploadResult): AppConfigForm {
  return {
    appName: upload.filename.replace(/\.(html?|zip)$/i, '').slice(0, 40) || 'My Web App',
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
    allowFileAccess: false,
    externalLinks: 'external',
    cacheMode: 'default',
    mixedContent: 'never',
    openFileChooser: true,
    downloadsEnabled: true,
    userAgentSuffix: '',
    permissions: { internet: upload.analysis.externalHosts.length > 0, camera: false, microphone: false, location: false, fileAccess: false, notifications: false },
    buildType: 'DEBUG',
    buildTargets: 'APK',
    generateAab: false,
    entryPath: '',
    releaseKeystoreId: null,
  };
}

export function ConfigView({
  upload,
  onStartBuild,
  onCancel,
}: {
  upload: UploadResult;
  onStartBuild: (config: AppConfigForm) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<AppConfigForm>(() => ({
    ...defaultConfig(upload),
    entryPath: upload.analysis.entryPath || '',
  }));
  const [iconBusy, setIconBusy] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [keystores, setKeystores] = useState<KeystoreRow[]>([]);
  const [building, setBuilding] = useState(false);
  const [customEntry, setCustomEntry] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCfg((c) => ({ ...c, entryPath: upload.analysis.entryPath || '' }));
    setCustomEntry(false);
    api.listKeystores().then((r) => setKeystores(r.keystores)).catch(() => { });
  }, [upload]);

  function set<K extends keyof AppConfigForm>(key: K, value: AppConfigForm[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
  }
  function setPerm(key: keyof AppConfigForm['permissions'], value: boolean) {
    setCfg((c) => ({ ...c, permissions: { ...c.permissions, [key]: value } }));
  }

  const pkgError = useMemo(() => {
    const pkg = cfg.packageName;
    if (!pkg) return 'Package name is required.';
    if (!PKG_RE.test(pkg)) return 'Use reverse-domain format: com.example.myapp';
    if (pkg.split('.').some((s) => JAVA_KEYWORDS.has(s))) return 'Contains a reserved Java keyword.';
    if (/^(java|android|com\.android|com\.google)\./.test(pkg)) return 'Reserved prefix (java.*, android.*, …).';
    return null;
  }, [cfg.packageName]);

  const nameError = cfg.appName.trim() ? null : 'Application name is required.';
  const verError = /^\d{1,3}(\.\d{1,3}){0,3}$/.test(cfg.versionName) ? null : 'Version name like 1.0 or 2.3.1';
  // AAB is always release-signed — any target that includes it needs a keystore
  const needsKeystore = cfg.buildTargets !== 'APK' || cfg.buildType === 'RELEASE';
  const releaseError = needsKeystore && !cfg.releaseKeystoreId
    ? (cfg.buildTargets === 'AAB'
      ? 'AAB builds must be signed with a release keystore — generate or upload one below.'
      : 'This build includes an AAB (always release-signed) — select a signing keystore below.')
    : null;
  const entryError = cfg.entryPath ? null : 'Select the entry HTML page.';
  const canBuild = !pkgError && !nameError && !verError && !releaseError && !entryError && !building;

  async function handleIcon(file: File) {
    if (file.size > 5 * 1024 * 1024) { toast({ title: 'Icon too large', description: 'Maximum 5 MB.', variant: 'destructive' }); return; }
    setIconBusy(true);
    try {
      const res = await api.uploadIcon(file);
      set('iconId', res.iconId);
      setIconPreview(URL.createObjectURL(file));
      toast({ title: 'Icon uploaded', description: 'Launcher icons will be generated for all densities.' });
    } catch (e) {
      toast({ title: 'Icon rejected', description: e instanceof ApiError ? e.message : 'Upload failed.', variant: 'destructive' });
    } finally {
      setIconBusy(false);
    }
  }

  async function startBuild() {
    setBuilding(true);
    try {
      await onStartBuild(cfg);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <main className="flex-1 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-col gap-1 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Configure your Android app</h1>
          <p className="text-muted-foreground">
            {upload.filename} · {upload.analysis.fileCount} file(s) · entry: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{cfg.entryPath || '…'}</code>
          </p>
        </div>

        <div className="space-y-6">
          {upload.analysis.warnings.length > 0 && (
            <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400 [&>svg]:text-amber-500">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc space-y-1.5 pl-4">
                  {upload.analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* ---------------- Basic information ---------------- */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Smartphone className="h-5 w-5 text-primary" /> Basic information</CardTitle>
              <CardDescription>Identity shown on the device launcher and in system settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="shrink-0">
                  <Label>App icon</Label>
                  <button
                    type="button"
                    onClick={() => iconInputRef.current?.click()}
                    className="mt-2 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border transition-colors hover:border-primary/60"
                    aria-label="Upload app icon"
                  >
                    {iconBusy ? <Loader2 className="h-5 w-5 animate-spin" />
                      : iconPreview ? <img src={iconPreview} alt="App icon preview" className="h-full w-full object-cover" />
                        : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
                  </button>
                  <input ref={iconInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleIcon(f); e.target.value = ''; }} />
                  <p className="mt-1.5 max-w-20 text-center text-[10px] leading-tight text-muted-foreground">PNG/JPG/WebP ≥48px</p>
                </div>
                <div className="grid flex-1 gap-4 sm:grid-cols-2">
                  <Field label="Application name" error={nameError} required>
                    <Input value={cfg.appName} maxLength={50} onChange={(e) => set('appName', e.target.value)} placeholder="My Web App" />
                  </Field>
                  <Field label="Package name" error={pkgError} required hint="Reverse-domain, unique per device">
                    <Input value={cfg.packageName} onChange={(e) => set('packageName', e.target.value.toLowerCase())} placeholder="com.example.mywebapp" className="font-mono text-sm" />
                  </Field>
                  <Field label="Version name" error={verError} required>
                    <Input value={cfg.versionName} onChange={(e) => set('versionName', e.target.value)} placeholder="1.0" className="font-mono" />
                  </Field>
                  <Field label="Version code" hint="Bump for updates">
                    <Input type="number" min={1} value={cfg.versionCode} onChange={(e) => set('versionCode', Math.max(1, Number(e.target.value) || 1))} className="font-mono" />
                  </Field>
                  <Field label="App description" hint="Stored in app metadata">
                    <Input value={cfg.description} maxLength={300} onChange={(e) => set('description', e.target.value)} placeholder="What does your app do?" />
                  </Field>
                  <Field label="App language" hint="UI locale of the app">
                    <Select value={cfg.language} onValueChange={(v) => set('language', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['en', 'zh', 'es', 'pt-BR', 'fr', 'de', 'ru', 'ar', 'hi', 'ja', 'ko', 'id', 'tr', 'it'].map((l) => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>

              <Separator />

              <Field label="Entry HTML page" error={entryError} required hint="The page shown when the app opens">
                {upload.analysis.htmlFiles.length > 0 && !customEntry ? (
                  <Select
                    value={cfg.entryPath || undefined}
                    onValueChange={(v) => {
                      if (v === '__custom__') { setCustomEntry(true); set('entryPath', ''); }
                      else set('entryPath', v);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select the start page…" /></SelectTrigger>
                    <SelectContent>
                      {upload.analysis.htmlFiles.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      <SelectItem value="__custom__">Other — type a path…</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-2">
                    <Input value={cfg.entryPath} onChange={(e) => set('entryPath', e.target.value)} placeholder="index.html" className="font-mono" />
                    {upload.analysis.htmlFiles.length > 0 && (
                      <Button variant="ghost" type="button" onClick={() => setCustomEntry(false)}>Pick from list</Button>
                    )}
                  </div>
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Theme color" hint="Used as fallback accent">
                  <ColorInput value={cfg.themeColor} onChange={(v) => set('themeColor', v)} />
                </Field>
                <div className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                  <div>
                    <Label htmlFor="splash">Splash screen</Label>
                    <p className="text-xs text-muted-foreground">Logo + spinner shown until the page loads</p>
                  </div>
                  <Switch id="splash" checked={cfg.splashEnabled} onCheckedChange={(v) => set('splashEnabled', v)} />
                </div>
              </div>
              {cfg.splashEnabled && (
                <Field label="Splash background color">
                  <ColorInput value={cfg.splashColor} onChange={(v) => set('splashColor', v)} />
                </Field>
              )}
            </CardContent>
          </Card>

          {/* ---------------- Screen ---------------- */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><MonitorSmartphone className="h-5 w-5 text-primary" /> Screen</CardTitle>
              <CardDescription>Orientation, system bars and display behavior.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Orientation">
                <RadioGroup value={cfg.orientation} onValueChange={(v) => set('orientation', v as AppConfigForm['orientation'])} className="grid grid-cols-3 gap-2">
                  {[['portrait', 'Portrait'], ['landscape', 'Landscape'], ['auto', 'Automatic']].map(([v, label]) => (
                    <Label key={v} htmlFor={`orient-${v}`} className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 text-sm font-normal transition-colors ${cfg.orientation === v ? 'border-primary bg-primary/5 text-primary' : 'border-border'}`}>
                      <RadioGroupItem id={`orient-${v}`} value={v} className="sr-only" /> {label}
                    </Label>
                  ))}
                </RadioGroup>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                  <div><Label htmlFor="fullscreen">Fullscreen mode</Label><p className="text-xs text-muted-foreground">Hide status &amp; navigation bars</p></div>
                  <Switch id="fullscreen" checked={cfg.fullscreen} onCheckedChange={(v) => set('fullscreen', v)} />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                  <div><Label htmlFor="statusbar">Status bar visible</Label><p className="text-xs text-muted-foreground">Disable for immersive apps</p></div>
                  <Switch id="statusbar" checked={cfg.statusBarVisible} onCheckedChange={(v) => set('statusBarVisible', v)} />
                </div>
                <Field label="Status bar color"><ColorInput value={cfg.statusBarColor} onChange={(v) => set('statusBarColor', v)} /></Field>
                <Field label="Navigation bar color"><ColorInput value={cfg.navigationBarColor} onChange={(v) => set('navigationBarColor', v)} /></Field>
              </div>
              <Field label="Screen brightness" hint="Bright locks a high brightness level">
                <RadioGroup value={cfg.brightness} onValueChange={(v) => set('brightness', v as AppConfigForm['brightness'])} className="flex gap-2">
                  <Label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm font-normal ${cfg.brightness === 'system' ? 'border-primary bg-primary/5 text-primary' : 'border-border'}`}>
                    <RadioGroupItem value="system" className="sr-only" /> Follow system
                  </Label>
                  <Label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm font-normal ${cfg.brightness === 'bright' ? 'border-primary bg-primary/5 text-primary' : 'border-border'}`}>
                    <RadioGroupItem value="bright" className="sr-only" /> Keep bright
                  </Label>
                </RadioGroup>
              </Field>
            </CardContent>
          </Card>

          {/* ---------------- WebView ---------------- */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><SlidersHorizontal className="h-5 w-5 text-primary" /> WebView configuration</CardTitle>
              <CardDescription>How your website runs inside the app. Secure defaults enabled.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Toggle label="JavaScript" desc="Required by most sites" checked={cfg.javascriptEnabled} onChange={(v) => set('javascriptEnabled', v)} />
                <Toggle label="DOM storage / LocalStorage" desc="Persist data in the page" checked={cfg.domStorageEnabled} onChange={(v) => set('domStorageEnabled', v)} />
                <Toggle label="Database storage" desc="Legacy WebSQL where supported" checked={cfg.databaseEnabled} onChange={(v) => set('databaseEnabled', v)} />
                <Toggle label="Zoom controls" desc="Pinch-zoom & on-screen buttons" checked={cfg.zoomControls} onChange={(v) => set('zoomControls', v)} />
                <Toggle label="File access" desc="Legacy file:// access — not needed unless your site opens local files" checked={cfg.allowFileAccess} onChange={(v) => set('allowFileAccess', v)} />
                <Toggle label="File chooser" desc="Support <input type=file> uploads" checked={cfg.openFileChooser} onChange={(v) => set('openFileChooser', v)} />
                <Toggle label="Downloads" desc="Save files via Download Manager" checked={cfg.downloadsEnabled} onChange={(v) => set('downloadsEnabled', v)} />
              </div>

              <Separator />

              <Field label={`Text zoom: ${cfg.textZoom}%`} hint="Scales page text for readability">
                <Slider value={[cfg.textZoom]} min={50} max={200} step={5} onValueChange={([v]) => set('textZoom', v)} className="max-w-xs" />
              </Field>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="External links" hint="Where other websites open">
                  <Select value={cfg.externalLinks} onValueChange={(v) => set('externalLinks', v as AppConfigForm['externalLinks'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="external">Open in browser</SelectItem>
                      <SelectItem value="webview">Keep inside app</SelectItem>
                      <SelectItem value="ask">Ask every time</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Cache mode" hint="offlineFirst helps weak networks">
                  <Select value={cfg.cacheMode} onValueChange={(v) => set('cacheMode', v as AppConfigForm['cacheMode'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="noCache">No cache</SelectItem>
                      <SelectItem value="offlineFirst">Offline first</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Mixed content" hint="Keep 'Never' unless you must load http:// inside https:// pages">
                  <Select value={cfg.mixedContent} onValueChange={(v) => set('mixedContent', v as AppConfigForm['mixedContent'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never allow (secure)</SelectItem>
                      <SelectItem value="compatibility">Compatibility mode</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="User agent suffix" hint="Appended to the WebView user-agent string">
                <Input value={cfg.userAgentSuffix} maxLength={120} onChange={(e) => set('userAgentSuffix', e.target.value)} placeholder="e.g. MyApp/1.0 (optional)" className="font-mono text-sm" />
              </Field>
            </CardContent>
          </Card>

          {/* ---------------- Permissions ---------------- */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" /> Android permissions</CardTitle>
              <CardDescription>Only enable what your app actually needs — each permission is explained. Unselected permissions are never written to the manifest.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {PERMISSION_INFO.map((p) => (
                <div key={p.key} className="flex items-start justify-between gap-4 rounded-xl border border-border/60 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`perm-${p.key}`}>{p.label}</Label>
                      {p.key === 'internet' && <Badge variant="secondary" className="text-[10px]">recommended</Badge>}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.why}</p>
                  </div>
                  <Switch id={`perm-${p.key}`} checked={cfg.permissions[p.key]} onCheckedChange={(v) => setPerm(p.key, v)} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* ---------------- Build target & signing ---------------- */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-5 w-5 text-primary" /> Build target &amp; signing</CardTitle>
              <CardDescription>Choose what to produce. APK installs directly on devices; AAB is the Google Play upload format.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Build target: APK / AAB / Both */}
              <div>
                <Label className="text-[13px]">What do you want to build?</Label>
                <RadioGroup
                  value={cfg.buildTargets}
                  onValueChange={(v) => set('buildTargets', v as AppConfigForm['buildTargets'])}
                  className="mt-2 grid gap-3 sm:grid-cols-3"
                >
                  <Label htmlFor="target-apk" className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 font-normal transition-colors ${cfg.buildTargets === 'APK' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <div className="flex items-center gap-2 font-medium"><RadioGroupItem id="target-apk" value="APK" className="sr-only" />
                      {cfg.buildTargets === 'APK' ? <Check className="h-4 w-4 text-primary" /> : <span className="h-4 w-4" />} Build APK</div>
                    <span className="text-xs text-muted-foreground">Installable Android package — sideload or distribute directly.</span>
                  </Label>
                  <Label htmlFor="target-aab" className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 font-normal transition-colors ${cfg.buildTargets === 'AAB' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <div className="flex items-center gap-2 font-medium"><RadioGroupItem id="target-aab" value="AAB" className="sr-only" />
                      {cfg.buildTargets === 'AAB' ? <Check className="h-4 w-4 text-primary" /> : <span className="h-4 w-4" />} Build AAB</div>
                    <span className="text-xs text-muted-foreground">Android App Bundle via bundleRelease — required for Google Play.</span>
                  </Label>
                  <Label htmlFor="target-both" className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 font-normal transition-colors ${cfg.buildTargets === 'BOTH' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <div className="flex items-center gap-2 font-medium"><RadioGroupItem id="target-both" value="BOTH" className="sr-only" />
                      {cfg.buildTargets === 'BOTH' ? <Check className="h-4 w-4 text-primary" /> : <span className="h-4 w-4" />} Build Both</div>
                    <span className="text-xs text-muted-foreground">APK + AAB in one Gradle run — same package &amp; version.</span>
                  </Label>
                </RadioGroup>
                {cfg.buildTargets !== 'APK' && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    The AAB is always built in release mode with the <code className="mx-1">bundleRelease</code> task and signed with your release keystore (Google Play requirement) — same package name, version code and version name as the APK.
                  </p>
                )}
              </div>

              {/* APK variant — only relevant when an APK is produced */}
              {cfg.buildTargets !== 'AAB' && (
                <RadioGroup value={cfg.buildType} onValueChange={(v) => set('buildType', v as AppConfigForm['buildType'])} className="grid gap-3 sm:grid-cols-2">
                  <Label htmlFor="bt-debug" className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 font-normal transition-colors ${cfg.buildType === 'DEBUG' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <div className="flex items-center gap-2 font-medium"><RadioGroupItem id="bt-debug" value="DEBUG" className="sr-only" />
                      {cfg.buildType === 'DEBUG' ? <Check className="h-4 w-4 text-primary" /> : <span className="h-4 w-4" />} Debug APK</div>
                    <span className="text-xs text-muted-foreground">Auto-signed with a debug key. Perfect for installing and testing on your device.</span>
                  </Label>
                  <Label htmlFor="bt-release" className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 font-normal transition-colors ${cfg.buildType === 'RELEASE' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <div className="flex items-center gap-2 font-medium"><RadioGroupItem id="bt-release" value="RELEASE" className="sr-only" />
                      {cfg.buildType === 'RELEASE' ? <Check className="h-4 w-4 text-primary" /> : <span className="h-4 w-4" />} Signed release APK</div>
                    <span className="text-xs text-muted-foreground">Signed with your keystore — publishable. Keep the keystore safe for future updates.</span>
                  </Label>
                </RadioGroup>
              )}
              {cfg.buildTargets === 'AAB' && (
                <div className="rounded-xl border border-border/60 p-4 text-xs text-muted-foreground">
                  AAB-only build — no APK variant needed. The bundle is produced with <code className="mx-1">bundleRelease</code> and verified (jarsigner + bundletool) before download.
                </div>
              )}

              {needsKeystore && (
                <KeystoreManager keystores={keystores} selectedId={cfg.releaseKeystoreId}
                  onSelect={(id) => set('releaseKeystoreId', id)}
                  onChanged={(list) => setKeystores(list)} />
              )}
            </CardContent>
          </Card>

          {/* Sticky build bar */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="sticky bottom-4 z-40">
            <Card className="border-primary/30 bg-card/95 shadow-xl shadow-black/5 backdrop-blur">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="gap-1"><Smartphone className="h-3 w-3" /> {cfg.appName || '—'}</Badge>
                  <Badge variant="outline" className="font-mono">{cfg.packageName}</Badge>
                  <Badge variant="outline" className="gap-1"><FileArchive className="h-3 w-3" /> v{cfg.versionName}+{cfg.versionCode}</Badge>
                  <Badge variant={cfg.buildTargets === 'APK' ? (cfg.buildType === 'RELEASE' ? 'default' : 'secondary') : 'default'}>
                    {cfg.buildTargets === 'APK' ? `${cfg.buildType} APK` : cfg.buildTargets === 'AAB' ? 'AAB' : 'APK + AAB'}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                  <Button disabled={!canBuild} onClick={() => void startBuild()} className="gap-2">
                    {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {cfg.buildTargets === 'APK' ? `Build ${cfg.buildType === 'RELEASE' ? 'Release' : 'Debug'} APK`
                      : cfg.buildTargets === 'AAB' ? 'Build AAB' : 'Build APK + AAB'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {(releaseError || entryError) && (
            <Alert className="border-destructive/40">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{releaseError || entryError}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- helpers
function Field({ label, hint, error, required, children }: {
  label: string; hint?: string; error?: string | null; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-[13px]">{label}{required && <span className="text-destructive">*</span>}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p>
        : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-4">
      <div><Label htmlFor={`tg-${label}`}>{label}</Label><p className="text-xs text-muted-foreground">{desc}</p></div>
      <Switch id={`tg-${label}`} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    // adjust state during render when the prop changes (React-sanctioned pattern)
    setSyncedValue(value);
    setLocal(value);
  }
  const valid = /^#[0-9a-fA-F]{6}$/.test(local);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color" value={valid ? local : '#000000'} aria-label={`${value} color picker`}
        onChange={(e) => { setLocal(e.target.value.toUpperCase()); onChange(e.target.value.toUpperCase()); }}
        className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-transparent p-1"
      />
      <Input value={local} onChange={(e) => { setLocal(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase()); }}
        className="w-28 font-mono text-sm" maxLength={7} />
    </div>
  );
}

function KeystoreManager({ keystores, selectedId, onSelect, onChanged }: {
  keystores: KeystoreRow[]; selectedId: string | null;
  onSelect: (id: string) => void; onChanged: (list: KeystoreRow[]) => void;
}) {
  const { toast } = useToast();
  const [genOpen, setGenOpen] = useState(false);
  const [upOpen, setUpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alias, setAlias] = useState('release-key');
  const [password, setPassword] = useState('');
  const [commonName, setCommonName] = useState('');
  const [organization, setOrganization] = useState('');
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upAlias, setUpAlias] = useState('');
  const [upPassword, setUpPassword] = useState('');
  const upInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const r = await api.listKeystores();
    onChanged(r.keystores);
  }

  async function generate() {
    setBusy(true);
    try {
      const res = await api.generateKeystore({ alias, password, commonName: commonName || undefined, organization: organization || undefined });
      await refresh();
      onSelect(res.keystore.id);
      setGenOpen(false);
      setPassword('');
      toast({ title: 'Keystore created', description: `Alias "${res.keystore.alias}" selected for signing.` });
    } catch (e) {
      toast({ title: 'Keystore creation failed', description: e instanceof ApiError ? e.message : 'Unexpected error.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  async function uploadKs() {
    if (!upFile) return;
    setBusy(true);
    try {
      const res = await api.uploadKeystore(upFile, upAlias, upPassword, upPassword);
      await refresh();
      onSelect(res.keystore.id);
      setUpOpen(false);
      setUpFile(null); setUpPassword('');
      toast({ title: 'Keystore uploaded & validated', description: `Alias "${res.keystore.alias}" selected.` });
    } catch (e) {
      toast({ title: 'Keystore rejected', description: e instanceof ApiError ? e.message : 'Unexpected error.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteKeystore(id);
      await refresh();
      toast({ title: 'Keystore deleted' });
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof ApiError ? e.message : 'Unexpected error.', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Signing keystores</Label>
        <div className="flex gap-2">
          <Dialog open={genOpen} onOpenChange={setGenOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Generate</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a release keystore</DialogTitle>
                <DialogDescription>
                  RSA 2048, valid for 30 years. Store the password safely — you will need the same keystore for every future update of this app.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <Field label="Key alias" required><Input value={alias} onChange={(e) => setAlias(e.target.value)} className="font-mono text-sm" /></Field>
                <Field label="Keystore & key password" required hint="Minimum 6 characters — never shared or logged">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Common name (CN)"><Input value={commonName} onChange={(e) => setCommonName(e.target.value)} placeholder="Your Name" /></Field>
                  <Field label="Organization (O)"><Input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="Company" /></Field>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => void generate()} disabled={busy || !alias.trim() || password.length < 6}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />} Create keystore
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={upOpen} onOpenChange={setUpOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload your keystore</DialogTitle>
                <DialogDescription>.jks / .keystore files only. The password is validated with keytool, then encrypted (AES-256-GCM) — never stored in plaintext.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <Button variant="outline" className="justify-start gap-2" onClick={() => upInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> {upFile ? upFile.name : 'Choose keystore file…'}
                </Button>
                <input ref={upInputRef} type="file" accept=".jks,.keystore" className="hidden"
                  onChange={(e) => { setUpFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                <Field label="Key alias" required><Input value={upAlias} onChange={(e) => setUpAlias(e.target.value)} className="font-mono text-sm" placeholder="existing-alias" /></Field>
                <Field label="Keystore password" required>
                  <Input type="password" value={upPassword} onChange={(e) => setUpPassword(e.target.value)} placeholder="••••••••" />
                </Field>
              </div>
              <DialogFooter>
                <Button onClick={() => void uploadKs()} disabled={busy || !upFile || !upAlias.trim() || !upPassword}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />} Validate & save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {keystores.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No keystores yet — generate one above or upload your existing .jks file.
        </p>
      ) : (
        <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
          {keystores.map((k) => (
            <div key={k.id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${selectedId === k.id ? 'border-primary bg-primary/5' : 'border-border/60'}`}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onSelect(k.id)}>
                <KeyRound className={`h-4 w-4 shrink-0 ${selectedId === k.id ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium font-mono">{k.alias}</p>
                  <p className="text-[11px] text-muted-foreground">{[k.commonName, k.organization].filter(Boolean).join(' · ') || 'Keystore'}</p>
                </div>
              </button>
              <div className="flex items-center gap-1">
                {selectedId === k.id && <Badge variant="secondary" className="text-[10px]">selected</Badge>}
                <Button variant="ghost" size="icon" aria-label={`Delete ${k.alias}`} onClick={() => void remove(k.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Alert className="border-amber-500/40 bg-amber-500/5">
        <Info className="h-4 w-4 text-amber-500" />
        <AlertDescription className="text-xs leading-relaxed">
          Keep your release keystore and its passwords safe. If you lose the keystore, you will not be able to
          update your app with the same signature on app stores. Passwords are encrypted at rest and never logged.
        </AlertDescription>
      </Alert>
    </div>
  );
}
