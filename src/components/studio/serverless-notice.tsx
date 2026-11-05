'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

type Health = {
  hosting?: 'server' | 'serverless';
  dbAvailable?: boolean;
  engineReady?: boolean;
  buildsSupported?: boolean;
};

/**
 * Amber banner shown when the current host cannot run real builds
 * (Vercel / missing toolchain / unreachable database). Honest status:
 * no fake builds, no silent failures.
 */
export function ServerlessNotice() {
  const [health, setHealth] = useState<Health | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/system/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (mounted) setHealth(d); })
      .catch(() => { /* health unreachable — show nothing */ });
    return () => { mounted = false; };
  }, []);

  if (!health || health.buildsSupported !== false || dismissed) return null;

  const reasons: string[] = [];
  if (health.hosting === 'serverless') {
    reasons.push('serverless hosting (Vercel) cannot run Gradle builds or keep uploaded files');
  } else {
    if (health.dbAvailable === false) reasons.push('the database is not reachable');
    if (health.engineReady === false) reasons.push('the build toolchain is not set up (run "npm run setup:toolchain")');
  }

  return (
    <div role="status" className="border-b border-amber-500/30 bg-amber-500/10 text-amber-200">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2.5 sm:px-6">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
        <p className="flex-1 text-xs leading-relaxed sm:text-sm">
          <span className="font-semibold">Limited environment:</span> {reasons.join('; ')}. For
          full functionality deploy on a VPS in one command{' '}
          <code className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px]">docker compose up -d --build</code>{' '}
          (see DEPLOYMENT.md §9 in the repository).
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss notice"
          className="shrink-0 rounded p-1 text-amber-300/70 hover:bg-amber-500/10 hover:text-amber-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
