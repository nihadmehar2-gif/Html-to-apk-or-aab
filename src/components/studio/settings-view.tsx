'use client';

import { useState } from 'react';
import { Loader2, User as UserIcon, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from './api';
import type { User } from './types';

export function SettingsView({ user, onUserUpdated }: {
  user: User;
  onUserUpdated: (u: User) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(user.name || '');
  const [savingName, setSavingName] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  async function saveName() {
    setSavingName(true);
    try {
      const r = await api.updateAccount({ name });
      onUserUpdated(r.user);
      toast({ title: 'Profile updated' });
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof ApiError ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword() {
    setSavingPass(true);
    try {
      await api.updateAccount({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      toast({ title: 'Password changed', description: 'Use your new password next time you log in.' });
    } catch (e) {
      toast({ title: 'Password change failed', description: e instanceof ApiError ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingPass(false);
    }
  }

  return (
    <main className="flex-1 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Account settings</h1>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><UserIcon className="h-5 w-5 text-primary" /> Profile</CardTitle>
            <CardDescription>{user.email}</CardDescription>
            <div className="mt-1"><Badge variant="secondary">{user.role}</Badge></div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settings-name">Display name</Label>
              <div className="flex gap-2">
                <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                <Button onClick={() => void saveName()} disabled={savingName || !name.trim()}>
                  {savingName && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-5 w-5 text-primary" /> Change password</CardTitle>
            <CardDescription>Passwords are hashed with scrypt — they cannot be recovered.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settings-cur">Current password</Label>
              <Input id="settings-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-new">New password</Label>
              <Input id="settings-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="Minimum 8 characters" />
            </div>
            <Button onClick={() => void savePassword()} disabled={savingPass || next.length < 8 || !current}>
              {savingPass && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
