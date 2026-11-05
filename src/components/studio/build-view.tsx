'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, CheckCircle2, XCircle, Terminal, Ban, RotateCcw, ArrowRight,
  FileCheck, FolderInput, PackageCheck, Hammer, Signature, ShieldCheck, Sparkles, Cog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api, ApiError } from './api';
import type { BuildRow } from './types';

const STEPS = [
  { key: 'uploading', label: 'Uploading Files', icon: FolderInput },
  { key: 'validating', label: 'Validating Project', icon: FileCheck },
  { key: 'extracting', label: 'Extracting Project', icon: PackageCheck },
  { key: 'preparing', label: 'Preparing Android Project', icon: Cog },
  { key: 'configuring', label: 'Configuring WebView', icon: SlidersIcon },
  { key: 'resources', label: 'Generating Android Resources', icon: Sparkles },
  { key: 'compiling', label: 'Compiling Android Application', icon: Hammer },
  { key: 'signing', label: 'Signing Artifacts', icon: Signature },
  { key: 'validatingApk', label: 'Validating Artifacts', icon: ShieldCheck },
  { key: 'completed', label: 'Build Completed', icon: CheckCircle2 },
];

function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function stepIndex(step: string): number {
  const idx = STEPS.findIndex((s) => s.key === step);
  return idx >= 0 ? idx : 0;
}

export function BuildView({ buildId, onDone, onGoDashboard }: {
  buildId: string;
  onDone: (build: BuildRow) => void;
  onGoDashboard: () => void;
}) {
  const [build, setBuild] = useState<BuildRow | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const b = await api.getBuild(buildId);
        if (cancelled) return;
        setBuild(b.build);
        const l = await api.getLogs(buildId, offsetRef.current);
        if (cancelled) return;
        offsetRef.current = l.offset;
        if (l.chunk) {
          setLogs((prev) => (prev + l.chunk).slice(-80000));
        }
        if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(b.build.status) && !doneRef.current) {
          doneRef.current = true;
          // fetch remaining logs once more, then finish
          const l2 = await api.getLogs(buildId, offsetRef.current).catch(() => null);
          if (l2 && l2.chunk) { offsetRef.current = l2.offset; setLogs((prev) => (prev + l2.chunk).slice(-80000)); }
          if (b.build.status === 'SUCCEEDED') {
            setTimeout(() => { if (!cancelled) onDone(b.build); }, 900);
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          if (!cancelled) setError('Build not found.');
        }
      }
    }

    void poll();
    const t = setInterval(() => { if (!doneRef.current) void poll(); }, 1800);
    return () => { cancelled = true; clearInterval(t); };
  }, [buildId, onDone]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <Alert className="max-w-md border-destructive/40">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Build unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button variant="outline" size="sm" className="mt-3" onClick={onGoDashboard}>Go to dashboard</Button>
        </Alert>
      </main>
    );
  }

  const currentIdx = build ? stepIndex(build.step) : 0;
  const failed = build && ['FAILED', 'CANCELLED', 'EXPIRED'].includes(build.status);

  return (
    <main className="flex-1 px-4 py-10 sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[340px_1fr]">
        {/* Steps panel */}
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}>
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">Build pipeline</h2>
                {build && (
                  <Badge variant="outline" className={statusBadgeClass(build.status)}>{build.status}</Badge>
                )}
              </div>
              {!build && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for worker…
                </div>
              )}
              <ol className="space-y-1">
                {STEPS.map((s, i) => {
                  const active = build && !failed && i === currentIdx;
                  const done = build && (failed ? i < currentIdx : i < currentIdx || build.progress >= 100);
                  const isFailedStep = failed && i === currentIdx;
                  return (
                    <li key={s.key} className={`flex items-center gap-3 rounded-lg px-2.5 py-2 ${active ? 'bg-primary/10' : ''}`}>
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${
                        isFailedStep ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : done ? 'border-primary/40 bg-primary/15 text-primary'
                            : active ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground'}`}>
                        {isFailedStep ? <XCircle className="h-3.5 w-3.5" />
                          : done ? <CheckCircle2 className="h-3.5 w-3.5" />
                            : <s.icon className="h-3.5 w-3.5" />}
                      </span>
                      <span className={`text-[13px] ${active ? 'font-medium text-foreground' : done ? 'text-foreground/80' : 'text-muted-foreground'}`}>
                        {i + 1}. {s.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>{build?.step || 'Queued'}</span>
                  <span>{build?.progress ?? 0}%</span>
                </div>
                <Progress value={build?.progress ?? 0} className="h-2" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Logs + error panel */}
        <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="min-w-0 space-y-4">
          {failed && build && (
            <Alert className="border-destructive/40 bg-destructive/5">
              <XCircle className="h-4 w-4" />
              <AlertTitle>
                {build.status === 'CANCELLED' ? 'Build cancelled' : 'Build failed'}
              </AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">{build.errorMessage || 'The build failed. Check the logs below.'}</AlertDescription>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="gap-1.5" onClick={async () => {
                  try {
                    const r = await api.retryBuild(build.id);
                    window.location.hash = '';
                    window.dispatchEvent(new CustomEvent('h2a:retry', { detail: r.buildId }));
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'Retry failed');
                  }
                }}>
                  <RotateCcw className="h-3.5 w-3.5" /> Retry build
                </Button>
                <Button size="sm" variant="outline" onClick={onGoDashboard}>Dashboard</Button>
              </div>
            </Alert>
          )}

          <Card className="overflow-hidden border-border/60">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Terminal className="h-4 w-4 text-primary" /> Build logs
                {build && <span className="text-xs font-normal text-muted-foreground">· {build.appName}</span>}
              </div>
              {['QUEUED', 'RUNNING'].includes(build?.status || '') && (
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => api.cancelBuild(build!.id)}>
                  <Ban className="h-3 w-3" /> Cancel
                </Button>
              )}
            </div>
            <div
              ref={logRef}
              className="max-h-[440px] min-h-[320px] overflow-y-auto bg-[#0b1120] p-4 font-mono text-[11.5px] leading-relaxed text-emerald-100/90"
              aria-live="polite"
              aria-label="Build log output"
            >
              {logs ? (
                logs.split('\n').map((line, i) => (
                  <div key={i} className={
                    line.includes('BUILD FAILED') || line.startsWith('!!!') ? 'text-red-400'
                      : line.includes('BUILD SUCCESSFUL') || line.includes('BUILD SUCCEEDED') ? 'text-emerald-400 font-semibold'
                        : line.startsWith('[') ? 'text-slate-500'
                          : line.startsWith('==> ') ? 'text-sky-300'
                            : 'text-emerald-100/80'
                  }>
                    {line || ' '}
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for build output…
                </div>
              )}
            </div>
          </Card>

          {build && build.status === 'SUCCEEDED' && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">
                    {build.hasAab
                      ? (build.hasApk ? 'APK + AAB compiled, signed and verified — opening result…' : 'AAB compiled, signed and verified — opening result…')
                      : 'APK compiled, signed and verified — opening result…'}
                  </span>
                </div>
                <Button size="sm" className="gap-1.5" onClick={() => onDone(build)}>
                  View result <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </div>
    </main>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'SUCCEEDED': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500';
    case 'RUNNING': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
    case 'QUEUED': return 'border-amber-500/40 bg-amber-500/10 text-amber-500';
    case 'FAILED': return 'border-red-500/40 bg-red-500/10 text-red-500';
    case 'CANCELLED': return 'border-zinc-500/40 bg-zinc-500/10 text-zinc-400';
    default: return 'border-zinc-500/40 bg-zinc-500/10 text-zinc-400';
  }
}
