'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Download, FileArchive, RotateCcw, Terminal, CheckCircle2, Package, Smartphone,
  ShieldCheck, Calendar, HardDrive, Loader2, Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { api } from './api';
import { formatBytes, formatDate, type BuildRow } from './types';

export function ResultView({
  build: initialBuild,
  onBuildAgain,
  onDashboard,
  onNewUpload,
}: {
  build: BuildRow;
  onBuildAgain: (buildId: string) => void;
  onDashboard: () => void;
  onNewUpload: () => void;
}) {
  const { toast } = useToast();
  const [build, setBuild] = useState(initialBuild);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [retrying, setRetrying] = useState(false);

  // Adaptive headline/subtitle per produced artifacts (APK only / AAB only / both)
  const both = build.hasApk && build.hasAab;
  const aabOnly = !build.hasApk && build.hasAab;
  const headline = both ? 'Your APK + AAB are ready 🎉'
    : aabOnly ? 'Your AAB is ready 🎉' : 'Your APK is ready 🎉';
  const subtitle = aabOnly
    ? 'Bundle compiled with the Gradle bundleRelease task, release-signed and verified with jarsigner + bundletool. Upload it to Google Play Console.'
    : both
      ? 'Compiled with Gradle in a single run — same package name, version code and version name. APK installs on devices; AAB uploads to Google Play.'
      : 'Compiled with Gradle, signed and verified with apksigner. Install it on any Android device.';

  async function openLogs() {
    setLogsOpen(true);
    if (!logs) {
      try {
        const l = await api.getLogs(build.id, 0);
        setLogs(l.total > 300000 ? `… log truncated (${formatBytes(l.total)}) …\n` + l.chunk.slice(-300000) : l.chunk);
      } catch { setLogs('Failed to load logs.'); }
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      const r = await api.retryBuild(build.id);
      onBuildAgain(r.buildId);
    } catch (e) {
      toast({ title: 'Retry failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="flex-1 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{headline}</h1>
          <p className="mt-2 text-muted-foreground">{subtitle}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-8">
          <Card className="border-border/60">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25">
                  <Smartphone className="h-7 w-7 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold">{build.appName}</h2>
                  <p className="truncate font-mono text-xs text-muted-foreground">{build.packageName}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="secondary">v{build.versionName} ({build.versionCode})</Badge>
                    <Badge variant="outline">{both ? 'APK + AAB' : aabOnly ? 'AAB build' : `${build.buildType} build`}</Badge>
                    <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> signature verified</Badge>
                  </div>
                </div>
              </div>

              <Separator className="my-5" />

              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
                {build.hasApk && <Detail icon={<Package className="h-3.5 w-3.5" />} label="APK size" value={formatBytes(build.apkSize)} />}
                {build.hasAab && <Detail icon={<FileArchive className="h-3.5 w-3.5" />} label="AAB size" value={formatBytes(build.aabSize)} />}
                <Detail icon={<HardDrive className="h-3.5 w-3.5" />} label="Build type" value={both ? 'APK + AAB' : aabOnly ? 'AAB (release)' : build.buildType} />
                <Detail icon={<Calendar className="h-3.5 w-3.5" />} label="Build date" value={formatDate(build.finishedAt || build.createdAt)} />
                <Detail icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Status" value={build.status} />
                <Detail icon={<Download className="h-3.5 w-3.5" />} label="Downloads" value={String(build.downloadCount)} />
              </dl>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                {build.hasApk ? (
                  <Button size="lg" className="flex-1 gap-2" asChild>
                    <a href={api.downloadUrl(build.id, 'apk')} download>
                      <Download className="h-4.5 w-4.5" /> Download APK ({formatBytes(build.apkSize)})
                    </a>
                  </Button>
                ) : build.hasAab ? (
                  <Button size="lg" className="flex-1 gap-2" asChild>
                    <a href={api.downloadUrl(build.id, 'aab')} download>
                      <FileArchive className="h-4.5 w-4.5" /> Download AAB ({formatBytes(build.aabSize)})
                    </a>
                  </Button>
                ) : (
                  <Button size="lg" className="flex-1 gap-2" disabled>
                    <Download className="h-4.5 w-4.5" /> Artifact expired
                  </Button>
                )}
                {build.hasApk && build.hasAab && (
                  <Button size="lg" variant="outline" className="gap-2" asChild>
                    <a href={api.downloadUrl(build.id, 'aab')} download>
                      <FileArchive className="h-4.5 w-4.5" /> AAB ({formatBytes(build.aabSize)})
                    </a>
                  </Button>
                )}
                <Button size="lg" variant="outline" className="gap-2" onClick={() => void openLogs()}>
                  <Terminal className="h-4.5 w-4.5" /> Build logs
                </Button>
              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" size="sm" onClick={onNewUpload}>New upload</Button>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void retry()} disabled={retrying}>
                  {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Build again
                </Button>
                <Button variant="ghost" size="sm" onClick={onDashboard}>Dashboard</Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="mt-4 rounded-xl border border-border/60 bg-card/50 p-4 text-xs leading-relaxed text-muted-foreground">
          {build.hasApk ? (
            <>
              <span className="font-medium text-foreground">Installing on Android:</span> open the downloaded file and
              confirm the install prompt — you may need to allow installs from your browser once
              (Settings → Apps → Special access → Install unknown apps). Artifacts are kept until{' '}
              {formatDate(build.expiresAt)}, then automatically deleted.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Uploading to Google Play:</span> open the Play Console,
              create a release and upload this .aab file — Play signs it with your app signing key. Keep your upload
              keystore safe: every future bundle must be signed with the same key. Artifacts are kept until{' '}
              {formatDate(build.expiresAt)}, then automatically deleted.
            </>
          )}
        </motion.div>
      </div>

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Terminal className="h-4 w-4 text-primary" /> Build logs</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-[#0b1120] p-4 font-mono text-[11px] leading-relaxed text-emerald-100/90">
            {logs ? logs.split('\n').map((l, i) => <div key={i}>{l || ' '}</div>) : <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

export function ExpiredNotice({ onDashboard }: { onDashboard: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <Card className="max-w-md border-border/60 text-center">
        <CardContent className="flex flex-col items-center gap-3 p-8">
          <Ban className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">This build has expired</h2>
          <p className="text-sm text-muted-foreground">
            Generated APKs are kept for 7 days and then automatically deleted to free storage.
          </p>
          <Button onClick={onDashboard}>Back to dashboard</Button>
        </CardContent>
      </Card>
    </main>
  );
}
