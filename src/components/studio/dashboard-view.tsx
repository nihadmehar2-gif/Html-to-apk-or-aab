'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Download, RotateCcw, Trash2, Plus, RefreshCw, PackageCheck, Loader2,
  FileCode2, FolderArchive, Search, Ban, FileArchive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from './api';
import { formatBytes, formatDate, STATUS_STYLES, type BuildRow } from './types';

export function DashboardView({
  onNewUpload, onOpenBuild,
}: {
  onNewUpload: () => void;
  onOpenBuild: (buildId: string) => void;
}) {
  const { toast } = useToast();
  const [builds, setBuilds] = useState<BuildRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listBuilds();
      setBuilds(r.builds);
    } catch (e) {
      toast({ title: 'Could not load builds', description: e instanceof ApiError ? e.message : undefined, variant: 'destructive' });
      setBuilds([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, fn: () => Promise<unknown>, message: string) {
    setBusyId(id);
    try {
      await fn();
      toast({ title: message });
      await load();
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof ApiError ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  const filtered = (builds || []).filter((b) =>
    !query ||
    b.appName.toLowerCase().includes(query.toLowerCase()) ||
    b.packageName.toLowerCase().includes(query.toLowerCase()) ||
    (b.project?.name || '').toLowerCase().includes(query.toLowerCase()));

  function targetLabel(b: BuildRow): string {
    const t = b.config?.buildTargets;
    if (t === 'AAB') return 'AAB';
    if (t === 'BOTH') return 'APK + AAB';
    if (t === 'APK') return b.buildType;
    // legacy builds: no buildTargets stored
    if (b.hasAab) return b.hasApk ? 'APK + AAB' : 'AAB';
    return b.buildType;
  }

  const active = (builds || []).filter((b) => ['QUEUED', 'RUNNING'].includes(b.status)).length;

  return (
    <main className="flex-1 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Build history</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {builds ? `${builds.length} build${builds.length === 1 ? '' : 's'} · ${active} active` : 'Loading…'}
              {' '}· artifacts kept for 7 days
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.75 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps…" className="w-44 pl-9 sm:w-56" />
            </div>
            <Button onClick={onNewUpload} className="gap-1.5"><Plus className="h-4 w-4" /> New build</Button>
          </div>
        </div>

        {!builds ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25">
                  <PackageCheck className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold">No builds yet</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Upload an HTML file or a ZIP website project and compile your first Android APK.
                  </p>
                </div>
                <Button className="gap-1.5" onClick={onNewUpload}><Plus className="h-4 w-4" /> Create your first build</Button>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <Card className="overflow-hidden border-border/60 py-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[180px]">Project / App</TableHead>
                    <TableHead className="hidden md:table-cell">Package</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead className="hidden lg:table-cell">APK size</TableHead>
                    <TableHead className="hidden lg:table-cell">AAB size</TableHead>
                    <TableHead className="hidden lg:table-cell">Date</TableHead>
                    <TableHead className="w-10 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow key={b.id} className="group">
                      <TableCell>
                        <button className="text-left" onClick={() => onOpenBuild(b.id)}>
                          <span className="flex items-center gap-2 font-medium">
                            {b.project?.sourceType === 'ZIP'
                              ? <FolderArchive className="h-4 w-4 shrink-0 text-primary" />
                              : <FileCode2 className="h-4 w-4 shrink-0 text-primary" />}
                            <span className="max-w-[180px] truncate">{b.appName}</span>
                          </span>
                          <span className="mt-0.5 block max-w-[220px] truncate text-xs text-muted-foreground">
                            {b.project?.name || '—'} · v{b.versionName}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="hidden max-w-[180px] truncate font-mono text-xs text-muted-foreground md:table-cell">
                        {b.packageName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_STYLES[b.status] || ''}>
                          {['QUEUED', 'RUNNING'].includes(b.status) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {b.status}
                        </Badge>
                        {b.status === 'EXPIRED' && (
                          <span className="block text-[10px] text-muted-foreground">files removed</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="secondary">{targetLabel(b)}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {b.hasApk ? formatBytes(b.apkSize) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {b.hasAab ? formatBytes(b.aabSize) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {formatDate(b.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {/* quick download buttons (visible on all screens, incl. mobile) */}
                          {b.status === 'SUCCEEDED' && b.hasApk && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                              <a href={api.downloadUrl(b.id, 'apk')} download aria-label={`Download APK of ${b.appName}`} title={`Download APK (${formatBytes(b.apkSize)})`}>
                                <Download className="h-4 w-4 text-primary" />
                              </a>
                            </Button>
                          )}
                          {b.status === 'SUCCEEDED' && b.hasAab && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                              <a href={api.downloadUrl(b.id, 'aab')} download aria-label={`Download AAB of ${b.appName}`} title={`Download AAB (${formatBytes(b.aabSize)})`}>
                                <FileArchive className="h-4 w-4 text-primary" />
                              </a>
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Actions for ${b.appName}`} disabled={busyId === b.id}>
                                {busyId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              </Button>
                            </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => onOpenBuild(b.id)}>
                              <PackageCheck className="mr-2 h-4 w-4" /> Open details
                            </DropdownMenuItem>
                            {b.status === 'SUCCEEDED' && b.hasApk && (
                              <DropdownMenuItem asChild>
                                <a href={api.downloadUrl(b.id, 'apk')} download>
                                  <Download className="mr-2 h-4 w-4" /> Download APK
                                </a>
                              </DropdownMenuItem>
                            )}
                            {b.status === 'SUCCEEDED' && b.hasAab && (
                              <DropdownMenuItem asChild>
                                <a href={api.downloadUrl(b.id, 'aab')} download>
                                  <Download className="mr-2 h-4 w-4" /> Download AAB
                                </a>
                              </DropdownMenuItem>
                            )}
                            {['FAILED', 'CANCELLED', 'SUCCEEDED', 'EXPIRED'].includes(b.status) && (
                              <DropdownMenuItem onClick={() => act(b.id, () => api.retryBuild(b.id).then((r) => onOpenBuild(r.buildId)), 'Build re-queued')}>
                                <RotateCcw className="mr-2 h-4 w-4" /> Rebuild
                              </DropdownMenuItem>
                            )}
                            {['QUEUED', 'RUNNING'].includes(b.status) && (
                              <DropdownMenuItem onClick={() => act(b.id, () => api.cancelBuild(b.id), 'Build cancelled')}>
                                <Ban className="mr-2 h-4 w-4" /> Cancel build
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => act(b.id, () => api.deleteBuild(b.id), 'Build deleted')}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete build
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
