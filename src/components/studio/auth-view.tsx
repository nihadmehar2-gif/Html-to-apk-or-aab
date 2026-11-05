'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Mail, KeyRound, User as UserIcon, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from './api';
import type { User } from './types';

export function AuthView({ onDone }: { onDone: (user: User) => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<'login' | 'register' | 'demo' | null>(null);

  async function submit(mode: 'login' | 'register' | 'demo', email: string, password: string, name = '') {
    setLoading(mode);
    try {
      const res = mode === 'register'
        ? await api.register(email, password, name)
        : mode === 'demo'
          ? await api.login('demo@html2apk.studio', 'demo1234')
          : await api.login(email, password);
      toast({ title: mode === 'register' ? 'Account created' : 'Welcome back!', description: res.user.email });
      onDone(res.user);
    } catch (e) {
      toast({
        title: 'Sign in failed',
        description: e instanceof ApiError ? e.message : 'Unexpected error. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card className="border-border/60">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Sign in to HTML2APK Studio</CardTitle>
            <CardDescription>Build and download APKs, keep your build history.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Log in</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <LoginForm onSubmit={(e, p) => submit('login', e, p)} loading={loading === 'login'} />
              </TabsContent>

              <TabsContent value="register">
                <RegisterForm onSubmit={(n, e, p) => submit('register', e, p, n)} loading={loading === 'register'} />
              </TabsContent>
            </Tabs>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>
            <Button variant="outline" className="w-full" disabled={loading !== null} onClick={() => submit('demo', '', '')}>
              {loading === 'demo' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Info className="mr-2 h-4 w-4" />}
              Try the demo account (pre-loaded sample project)
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              demo@html2apk.studio · demo1234
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </main>
  );
}

function LoginForm({ onSubmit, loading }: { onSubmit: (email: string, pass: string) => void; loading: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.trim() || !password) { setError('Email and password are required.'); return; }
        setError('');
        onSubmit(email.trim(), password);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-2.75 h-4 w-4 text-muted-foreground" />
          <Input id="login-email" type="email" autoComplete="email" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-pass">Password</Label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-2.75 h-4 w-4 text-muted-foreground" />
          <Input id="login-pass" type="password" autoComplete="current-password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Log in
      </Button>
    </form>
  );
}

function RegisterForm({ onSubmit, loading }: { onSubmit: (name: string, email: string, pass: string) => void; loading: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
        setError('');
        onSubmit(name.trim(), email.trim(), password);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="reg-name">Name</Label>
        <div className="relative">
          <UserIcon className="absolute left-3 top-2.75 h-4 w-4 text-muted-foreground" />
          <Input id="reg-name" className="pl-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reg-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-2.75 h-4 w-4 text-muted-foreground" />
          <Input id="reg-email" type="email" autoComplete="email" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reg-pass">Password</Label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-2.75 h-4 w-4 text-muted-foreground" />
          <Input id="reg-pass" type="password" autoComplete="new-password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 characters" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create account
      </Button>
    </form>
  );
}
