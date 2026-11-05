'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Users, FolderKanban, CheckCircle2, XCircle, Activity, HardDrive, RefreshCw,
  Cpu, MemoryStick, Server, Loader2, Ban, Trash2, ShieldCheck, ShieldOff, ChevronDown, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError, type AdminStats, type AdminUserRow, type AdminSystem } from './api';
import { formatBytes, formatDate, STATUS_STYLES, type BuildRow } from './types';

export function AdminView() {
  const { toast } = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [builds, setBuilds] = useState<BuildRow[] | null>(null);
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const [buildFilter, setBuildFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const [s, u, b, sys] = await Promise.all([
        api.adminStats(), api.adminUsers(),
        api.adminBuilds(buildFilter), api.adminSystem(),
      ]);
      setStats(s); setUsers(u.users); setBuilds(b.builds); setSystem(sys);
    } catch (e) {
      toast({ title: 'Admin data failed to load', description: e instanceof ApiError ? e.message : undefined, variant: 'destructive' });
    }
  }, [toast, buildFilter]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) void load(); };
    const initial = setTimeout(tick, 0);
    const t = setInterval(tick, 6000);
    return () => { cancelled = true; clearTimeout(initial); clearInterval(t); };
  }, [load]);

  async function userAction(id: string, action: 'suspend' | 'activate' | 'promote' | 'demote') {
    try { await api.adminAction(id, action); await load(); toast({ title: `User ${action}d` }); }
    catch (e) { toast({ title: 'Action failed', description: e instanceof ApiError ? e.message : undefined, variant: 'destructive' }); }
  }
  async function deleteUser(id: string) {
    try { await api.adminDeleteUser(id); await load(); toast({ title: 'User deleted with all data' }); }
    catch (e) { toast({ title: 'Delete failed', description: e instanceof ApiError ? e.message : undefined, variant: 'destructive' }); }
  }

  const memPct = system ? Math.round((1 - system.machine.memFree / system.machine.memTotal) * 100) : 0;

  return (
    <main className="flex-1 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              <Wrench className="h-7 w-7 text-primary" /> Admin dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Platform statistics, users, build jobs and build-engine health.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { icon: Users, label: 'Users', value: stats?.totals.users },
            { icon: FolderKanban, label: 'Projects', value: stats?.totals.projects },
            { icon: CheckCircle2, label: 'Succeeded builds', value: stats?.totals.succeeded, accent: 'text-emerald-500' },
            { icon: XCircle, label: 'Failed builds', value: stats?.totals.failed, accent: 'text-red-500' },
            { icon: Activity, label: 'Active jobs', value: stats?.totals.active, accent: 'text-amber-500' },
            { icon: HardDrive, label: 'Downloads', value: stats?.totals.downloads },
          ].map((c) => (
            <Card key={c.label} className="border-border/60">
              <CardContent className="p-4">
                <c.icon className={`mb-2 h-4.5 w-4.5 ${c.accent || 'text-muted-foreground'}`} />
                <p className="text-2xl font-bold">{c.value ?? <Skeleton className="h-7 w-10" />}</p>
                <p className="text-xs text-muted-foreground">{c.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="builds" className="mt-6">
          <TabsList>
            <TabsTrigger value="builds">Build jobs</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="system">System &amp; storage</TabsTrigger>
          </TabsList>

          {/* ------- Builds ------- */}
          <TabsContent value="builds">
            <div className="mb-3 flex items-center gap-2">
              {['all', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].map((f) => (
                <button key={f}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${buildFilter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setBuildFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
            <Card className="overflow-hidden border-border/60 py-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>App</TableHead>
                      <TableHead className="hidden md:table-cell">User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead className="hidden lg:table-cell">Size</TableHead>
                      <TableHead className="hidden lg:table-cell">Created</TableHead>
                      <TableHead className="w-10 text-right">Admin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(builds || []).map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>
                          <p className="font-medium">{b.appName}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{b.packageName}</p>
                        </TableCell>
                        <TableCell className="hidden text-sm md:table-cell">{b.user?.email}</TableCell>
                        <TableCell><Badge variant="outline" className={STATUS_STYLES[b.status] || ''}>{b.status}</Badge></TableCell>
                        <TableCell className="hidden sm:table-cell"><Badge variant="secondary">{b.buildType}</Badge></TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{b.apkSize ? formatBytes(b.apkSize) : '—'}</TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDate(b.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          {['QUEUED', 'RUNNING'].includes(b.status) && (
                            <Button variant="ghost" size="icon" aria-label="Cancel build"
                              onClick={() => api.cancelBuild(b.id).then(load)}>
                              <Ban className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(builds || []).length === 0 && (
                      <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No builds match this filter.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          {/* ------- Users ------- */}
          <TabsContent value="users">
            <Card className="overflow-hidden border-border/60 py-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>User</TableHead>
                      <TableHead className="hidden sm:table-cell">Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Projects</TableHead>
                      <TableHead className="hidden md:table-cell">Builds</TableHead>
                      <TableHead className="hidden lg:table-cell">Last login</TableHead>
                      <TableHead className="w-10 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(users || []).map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <p className="font-medium">{u.name || '—'}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant={u.role === 'ADMIN' ? 'default' : 'secondary'}>{u.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={u.status === 'ACTIVE' ? STATUS_STYLES.SUCCEEDED : STATUS_STYLES.FAILED}>
                            {u.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{u._count.projects}</TableCell>
                        <TableCell className="hidden md:table-cell">{u._count.builds}</TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDate(u.lastLoginAt)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`}><ChevronDown className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {u.status === 'ACTIVE'
                                ? <DropdownMenuItem onClick={() => userAction(u.id, 'suspend')}><ShieldOff className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>
                                : <DropdownMenuItem onClick={() => userAction(u.id, 'activate')}><ShieldCheck className="mr-2 h-4 w-4" /> Activate</DropdownMenuItem>}
                              {u.role === 'USER'
                                ? <DropdownMenuItem onClick={() => userAction(u.id, 'promote')}><ShieldCheck className="mr-2 h-4 w-4" /> Make admin</DropdownMenuItem>
                                : <DropdownMenuItem onClick={() => userAction(u.id, 'demote')}><ShieldOff className="mr-2 h-4 w-4" /> Revoke admin</DropdownMenuItem>}
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteUser(u.id)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete user &amp; data
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          {/* ------- System ------- */}
          <TabsContent value="system">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-border/60">
                <CardContent className="p-5">
                  <h3 className="mb-4 flex items-center gap-2 font-semibold"><Server className="h-4.5 w-4.5 text-primary" /> Build engine health</h3>
                  <ul className="space-y-2.5 text-sm">
                    {system ? Object.entries(system.engine).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between">
                        <span className="capitalize text-muted-foreground">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                        <Badge variant="outline" className={v ? STATUS_STYLES.SUCCEEDED : STATUS_STYLES.FAILED}>
                          {v ? 'OK' : 'MISSING'}
                        </Badge>
                      </li>
                    )) : <Skeleton className="h-8 w-full" />}
                  </ul>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-border/60 p-3">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Cpu className="h-3 w-3" /> CPUs</p>
                      <p className="mt-1 font-semibold">{system?.machine.cpus ?? '—'} cores</p>
                      <p className="text-[11px] text-muted-foreground">load {system ? system.machine.loadAvg.map((l) => l.toFixed(2)).join(' / ') : '—'}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 p-3">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MemoryStick className="h-3 w-3" /> Memory</p>
                      <p className="mt-1 font-semibold">{memPct}% used</p>
                      <p className="text-[11px] text-muted-foreground">{formatBytes(system?.machine.memFree)} free</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {system?.machine.platform} {system?.machine.arch} · uptime {system ? Math.round(system.machine.uptime / 3600) : '—'}h
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="p-5">
                  <h3 className="mb-4 flex items-center gap-2 font-semibold"><HardDrive className="h-4.5 w-4.5 text-primary" /> Storage usage</h3>
                  <ul className="space-y-3 text-sm">
                    {stats ? ([
                      ['Artifacts (APK/AAB)', stats.storage.apkBytes],
                      ['Uploaded projects', stats.storage.uploadBytes],
                      ['Build workspaces', stats.storage.workspaceBytes],
                      ['Keystores', stats.storage.keystoreBytes],
                    ] as [string, number][]).map(([label, bytes]) => (
                      <li key={label}>
                        <div className="mb-1 flex justify-between">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium">{formatBytes(bytes)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(2, (bytes / Math.max(1, stats.storage.apkBytes + stats.storage.uploadBytes + stats.storage.workspaceBytes + stats.storage.keystoreBytes)) * 100))}%` }} />
                        </div>
                      </li>
                    )) : <Skeleton className="h-8 w-full" />}
                  </ul>
                  <div className="mt-5 space-y-2 rounded-xl border border-border/60 p-4 text-sm">
                    <p className="flex justify-between"><span className="text-muted-foreground">Disk free</span><span className="font-medium">{formatBytes(stats?.disk.free)}</span></p>
                    <p className="flex justify-between"><span className="text-muted-foreground">Active workspaces</span><span className="font-medium">{system?.workspaces ?? '—'}</span></p>
                    <p className="flex justify-between"><span className="text-muted-foreground">Max concurrent builds</span><span className="font-medium">{stats?.limits.maxConcurrentBuilds}</span></p>
                    <p className="flex justify-between"><span className="text-muted-foreground">Build timeout</span><span className="font-medium">{stats?.limits.buildTimeoutMinutes} min</span></p>
                    <p className="flex justify-between"><span className="text-muted-foreground">Retention</span><span className="font-medium">{stats?.limits.retentionDays} days</span></p>
                    <p className="flex justify-between"><span className="text-muted-foreground">Upload limit</span><span className="font-medium">{stats?.limits.maxUploadMb} MB</span></p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
