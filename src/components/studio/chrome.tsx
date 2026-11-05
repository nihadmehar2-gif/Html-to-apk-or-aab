'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Moon, Sun, Smartphone, LayoutDashboard, ShieldCheck, Settings, LogOut, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { User } from './types';
import { api } from './api';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
        <Smartphone className="h-5 w-5 text-primary-foreground" />
      </div>
      <div className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight">HTML2APK</span>
        <span className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Studio</span>
      </div>
    </div>
  );
}

type View =
  | 'landing' | 'auth' | 'upload' | 'configure' | 'building' | 'result'
  | 'dashboard' | 'settings' | 'admin';

export function Navbar({ user, view, onNavigate }: { user: User | null; view: View; onNavigate: (v: View) => void }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const navItems: { label: string; view: View }[] = [
    ...(user ? [{ label: 'Dashboard', view: 'dashboard' as View }] : []),
    { label: 'New Build', view: 'upload' as View },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="#" onClick={(e) => { e.preventDefault(); onNavigate('landing'); }} aria-label="HTML2APK Studio home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {navItems.map((item) => (
            <Button
              key={item.view}
              variant="ghost"
              size="sm"
              className={`text-sm ${view === item.view ? 'text-foreground' : 'text-muted-foreground'}`}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
            </Button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost" size="icon" aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Sun className="h-4.5 w-4.5 dark:hidden" />
            <Moon className="hidden h-4.5 w-4.5 dark:block" />
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden max-w-[120px] truncate sm:inline">{user.name || user.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onNavigate('dashboard')}>
                  <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNavigate('settings')}>
                  <Settings className="mr-2 h-4 w-4" /> Account settings
                </DropdownMenuItem>
                {user.role === 'ADMIN' && (
                  <DropdownMenuItem onClick={() => onNavigate('admin')}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Admin dashboard
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={async () => { await api.logout(); window.location.reload(); }}>
                  <LogOut className="mr-2 h-4 w-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" onClick={() => onNavigate('auth')}>Sign in</Button>
          )}

          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border/60 bg-background px-4 py-2 md:hidden">
          {navItems.map((item) => (
            <button
              key={item.view}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted"
              onClick={() => { onNavigate(item.view); setOpen(false); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Convert HTML websites and ZIP web projects into real, installable Android apps —
              compiled with the actual Android SDK and Gradle on our build servers.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-12 sm:grid-cols-3">
            <div>
              <h3 className="text-sm font-semibold">Product</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground">Features</a></li>
                <li><a href="#how" className="hover:text-foreground">How it works</a></li>
                <li><a href="#formats" className="hover:text-foreground">Supported formats</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Resources</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li><a href="#faq" className="hover:text-foreground">FAQ</a></li>
                <li><a href="#security" className="hover:text-foreground">Security</a></li>
                <li><a href="#install" className="hover:text-foreground">Install guide</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Build engine</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>Android SDK 34</li>
                <li>Gradle 8.9</li>
                <li>Gradle builds · real APKs</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} HTML2APK Studio. Built with a real Android build pipeline.</span>
          <span>APKs are retained for 7 days · Uploads up to 50 MB</span>
        </div>
      </div>
    </footer>
  );
}
