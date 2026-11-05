'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/components/studio/api';
import { Navbar, Footer } from '@/components/studio/chrome';
import { Landing } from '@/components/studio/landing';
import { AuthView } from '@/components/studio/auth-view';
import { UploadView } from '@/components/studio/upload-view';
import { ConfigView } from '@/components/studio/config-view';
import { BuildView } from '@/components/studio/build-view';
import { ResultView, ExpiredNotice } from '@/components/studio/result-view';
import { DashboardView } from '@/components/studio/dashboard-view';
import { SettingsView } from '@/components/studio/settings-view';
import { AdminView } from '@/components/studio/admin-view';
import type { AppConfigForm, BuildRow, UploadResult, User } from '@/components/studio/types';

type View =
  | 'landing' | 'auth' | 'upload' | 'configure' | 'building' | 'result'
  | 'dashboard' | 'settings' | 'admin';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>('landing');
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [resultBuild, setResultBuild] = useState<BuildRow | null>(null);
  const bootDone = useRef(false);

  // ---------- boot: restore session ----------
  useEffect(() => {
    if (bootDone.current) return;
    bootDone.current = true;
    api.me()
      .then((r) => { setUser(r.user); })
      .catch(() => { })
      .finally(() => setBooted(true));
  }, []);

  // ---------- landing dropzone shortcut: jump straight to configure ----------
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UploadResult>).detail;
      setUpload(detail);
      setView('configure');
    };
    window.addEventListener('h2a:uploaded', handler);
    const retryHandler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setActiveBuildId(id);
      setResultBuild(null);
      setView('building');
    };
    window.addEventListener('h2a:retry', retryHandler);
    return () => {
      window.removeEventListener('h2a:uploaded', handler);
      window.removeEventListener('h2a:retry', retryHandler);
    };
  }, []);

  const requireAuth = useCallback((next: View) => {
    if (!user) {
      setView('auth');
      return;
    }
    setView(next);
  }, [user]);

  const startBuild = useCallback(async (config: AppConfigForm) => {
    if (!upload) return;
    try {
      const r = await api.createBuild(upload.projectId, config);
      setActiveBuildId(r.buildId);
      setResultBuild(null);
      setView('building');
    } catch (e) {
      const err = e as Error & { status?: number };
      throw err;
    }
  }, [upload]);

  const openBuild = useCallback(async (buildId: string) => {
    try {
      const r = await api.getBuild(buildId);
      if (r.build.status === 'SUCCEEDED') {
        setResultBuild(r.build);
        setView('result');
        return;
      }
      if (r.build.status === 'EXPIRED') {
        setResultBuild(null);
        setView('dashboard');
        return;
      }
      setActiveBuildId(buildId);
      setResultBuild(null);
      setView('building');
    } catch {
      setView('dashboard');
    }
  }, []);

  if (!booted) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar user={user} view={view} onNavigate={(v) => {
        if (v === 'admin' || v === 'dashboard' || v === 'settings' || v === 'upload') {
          requireAuth(v);
        } else {
          setView(v);
        }
        window.scrollTo({ top: 0 });
      }} />

      {view === 'landing' && (
        <Landing user={user} onStart={(mode) => {
          if (mode === 'auth') setView('auth');
          else requireAuth('upload');
          window.scrollTo({ top: 0 });
        }} />
      )}

      {view === 'auth' && (
        <AuthView onDone={(u) => { setUser(u); setView('upload'); window.scrollTo({ top: 0 }); }} />
      )}

      {view === 'upload' && (
        <UploadView
          onUploaded={(res) => { setUpload(res); setView('configure'); window.scrollTo({ top: 0 }); }}
          onPickExisting={() => { setView('dashboard'); window.scrollTo({ top: 0 }); }}
        />
      )}

      {view === 'configure' && upload && (
        <ConfigView
          upload={upload}
          onCancel={() => setView('upload')}
          onStartBuild={(cfg) => startBuild(cfg)}
        />
      )}

      {view === 'building' && activeBuildId && (
        <BuildView
          buildId={activeBuildId}
          onDone={(b) => { setResultBuild(b); setView('result'); window.scrollTo({ top: 0 }); }}
          onGoDashboard={() => { setView('dashboard'); window.scrollTo({ top: 0 }); }}
        />
      )}

      {view === 'result' && resultBuild && (
        resultBuild.status === 'EXPIRED'
          ? <ExpiredNotice onDashboard={() => setView('dashboard')} />
          : <ResultView
            build={resultBuild}
            onBuildAgain={(id) => { setActiveBuildId(id); setResultBuild(null); setView('building'); window.scrollTo({ top: 0 }); }}
            onDashboard={() => { setView('dashboard'); window.scrollTo({ top: 0 }); }}
            onNewUpload={() => { setUpload(null); setView('upload'); window.scrollTo({ top: 0 }); }}
          />
      )}

      {view === 'dashboard' && (
        <DashboardView
          onNewUpload={() => { setUpload(null); setView('upload'); window.scrollTo({ top: 0 }); }}
          onOpenBuild={openBuild}
        />
      )}

      {view === 'settings' && user && (
        <SettingsView user={user} onUserUpdated={setUser} />
      )}

      {view === 'admin' && user?.role === 'ADMIN' && <AdminView />}

      {view === 'admin' && user?.role !== 'ADMIN' && (
        <main className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">Administrator access required.</p>
        </main>
      )}

      {view === 'configure' && !upload && (
        <main className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">Upload a project first.</p>
        </main>
      )}

      <Footer />
    </div>
  );
}
