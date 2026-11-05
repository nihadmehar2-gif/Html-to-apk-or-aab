'use client';

import type { AppConfigForm, UploadResult } from './types';

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

async function handle<T>(res: Response): Promise<T> {
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    throw new ApiError(res.status, String(body.error || `Request failed (${res.status})`), body);
  }
  return body as T;
}

export const api = {
  me: () => fetch('/api/auth/me', { cache: 'no-store' }).then((r) => handle<{ user: import('./types').User | null }>(r)),
  login: (email: string, password: string) =>
    fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then((r) => handle<{ user: import('./types').User }>(r)),
  register: (email: string, password: string, name: string) =>
    fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }).then((r) => handle<{ user: import('./types').User }>(r)),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }).then((r) => handle<{ ok: boolean }>(r)),
  updateAccount: (data: { name?: string; currentPassword?: string; newPassword?: string }) =>
    fetch('/api/auth/me', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }).then((r) => handle<{ user: import('./types').User }>(r)),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/uploads', { method: 'POST', body: fd }).then((r) => handle<UploadResult>(r));
  },
  uploadIcon: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/uploads/icon', { method: 'POST', body: fd }).then((r) => handle<{ iconId: string }>(r));
  },
  listKeystores: () => fetch('/api/keystores', { cache: 'no-store' }).then((r) => handle<{ keystores: import('./types').KeystoreRow[] }>(r)),
  generateKeystore: (data: { alias: string; password: string; commonName?: string; organization?: string }) =>
    fetch('/api/keystores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'generate', ...data }),
    }).then((r) => handle<{ keystore: import('./types').KeystoreRow }>(r)),
  uploadKeystore: (file: File, alias: string, password: string, keyPassword: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alias', alias);
    fd.append('password', password);
    fd.append('keyPassword', keyPassword);
    return fetch('/api/keystores', { method: 'POST', body: fd }).then((r) => handle<{ keystore: import('./types').KeystoreRow }>(r));
  },
  deleteKeystore: (id: string) => fetch(`/api/keystores/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),

  createBuild: (projectId: string, config: AppConfigForm) =>
    fetch('/api/builds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, config }),
    }).then((r) => handle<{ buildId: string }>(r)),
  listBuilds: () => fetch('/api/builds', { cache: 'no-store' }).then((r) => handle<{ builds: import('./types').BuildRow[] }>(r)),
  getBuild: (id: string) => fetch(`/api/builds/${id}`, { cache: 'no-store' }).then((r) => handle<{ build: import('./types').BuildRow }>(r)),
  getLogs: (id: string, offset: number) =>
    fetch(`/api/builds/${id}/logs?offset=${offset}`, { cache: 'no-store' }).then((r) => handle<{ chunk: string; total: number; offset: number }>(r)),
  retryBuild: (id: string) => fetch(`/api/builds/${id}/retry`, { method: 'POST' }).then((r) => handle<{ buildId: string }>(r)),
  cancelBuild: (id: string) => fetch(`/api/builds/${id}/cancel`, { method: 'POST' }).then((r) => handle<{ ok: boolean }>(r)),
  deleteBuild: (id: string) => fetch(`/api/builds/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  downloadUrl: (id: string, type: 'apk' | 'aab' | 'logs') => `/api/builds/${id}/download?type=${type}`,

  adminStats: () => fetch('/api/admin/stats', { cache: 'no-store' }).then((r) => handle<AdminStats>(r)),
  adminUsers: () => fetch('/api/admin/users', { cache: 'no-store' }).then((r) => handle<{ users: AdminUserRow[] }>(r)),
  adminAction: (id: string, action: 'suspend' | 'activate' | 'promote' | 'demote') =>
    fetch(`/api/admin/users/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    }).then((r) => handle<Record<string, unknown>>(r)),
  adminDeleteUser: (id: string) => fetch(`/api/admin/users/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  adminBuilds: (status: string) => fetch(`/api/admin/builds?status=${status}`, { cache: 'no-store' }).then((r) => handle<{ builds: import('./types').BuildRow[] }>(r)),
  adminSystem: () => fetch('/api/admin/system', { cache: 'no-store' }).then((r) => handle<AdminSystem>(r)),
  health: () => fetch('/api/system/health', { cache: 'no-store' }).then((r) => handle<{ ok: boolean; engineReady: boolean; queue: { running: number; queued: number; maxConcurrent: number } }>(r)),
};

export type AdminStats = {
  totals: { users: number; projects: number; succeeded: number; failed: number; active: number; downloads: number };
  storage: { apkBytes: number; uploadBytes: number; keystoreBytes: number; workspaceBytes: number };
  disk: { free: number | null; total: number | null };
  limits: { maxConcurrentBuilds: number; buildTimeoutMinutes: number; retentionDays: number; maxUploadMb: number };
  recentBuilds: { id: string; status: string; buildType: string; appName: string; packageName: string; createdAt: string; projectName: string; userEmail: string }[];
};

export type AdminUserRow = {
  id: string; email: string; name: string | null; role: string; status: string;
  createdAt: string; lastLoginAt: string | null;
  _count: { projects: number; builds: number };
};

export type AdminSystem = {
  engine: Record<string, boolean>;
  engineReady: boolean;
  activeJobs: { id: string; status: string; step: string; progress: number; createdAt: string }[];
  workspaces: number;
  machine: { platform: string; release: string; arch: string; cpus: number; loadAvg: number[]; memTotal: number; memFree: number; uptime: number };
};
