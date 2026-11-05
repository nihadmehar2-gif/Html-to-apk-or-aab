'use client';

import { motion } from 'framer-motion';
import { useState, useRef } from 'react';
import {
  Upload, FileArchive, Zap, ShieldCheck, Cpu, Palette, MonitorSmartphone,
  CheckCircle2, ChevronDown, Smartphone, FileCode2, FolderArchive, Lock,
  Bell, Camera, MapPin, Mic, Download, RefreshCw, ArrowRight, HardDrive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { User } from './types';
import { api } from './api';

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.55, ease: 'easeOut' as const },
};

export function Landing({
  user, onStart,
}: {
  user: User | null;
  onStart: (mode: 'auth' | 'upload') => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!user) { onStart('auth'); return; }
    try {
      const res = await api.upload(file);
      window.dispatchEvent(new CustomEvent('h2a:uploaded', { detail: res }));
    } catch {
      onStart('upload');
    }
  }

  function handleFilePicked(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!user) { onStart('auth'); return; }
    api.upload(file)
      .then((res) => window.dispatchEvent(new CustomEvent('h2a:uploaded', { detail: res })))
      .catch(() => onStart('upload'));
  }

  return (
    <main className="flex-1">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,--alpha(var(--color-primary)/14%),transparent_70%)]"
        />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-24 lg:pt-20">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Badge variant="outline" className="mb-5 gap-1.5 border-primary/40 bg-primary/5 px-3 py-1 text-primary">
              <Cpu className="h-3.5 w-3.5" /> Real Gradle builds · Android SDK 34 · JDK 21
            </Badge>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Convert Your HTML Website into an{' '}
              <span className="bg-gradient-to-r from-primary via-emerald-400 to-teal-500 bg-clip-text text-transparent">
                Android APK
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Upload a single HTML file or a complete ZIP website project. HTML2APK Studio packages it into a
              real, installable Android application with a fully configurable WebView — compiled by the actual
              Android build tools, signed and ready to install.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-12 gap-2 px-6 text-[15px]" onClick={() => onStart(user ? 'upload' : 'auth')}>
                <FileCode2 className="h-5 w-5" /> Upload HTML File
              </Button>
              <Button size="lg" variant="outline" className="h-12 gap-2 px-6 text-[15px]" onClick={() => onStart(user ? 'upload' : 'auth')}>
                <FolderArchive className="h-5 w-5" /> Upload ZIP Project
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> No fake APKs — verified real builds</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Debug &amp; signed release</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> AAB output optional</span>
            </div>
          </motion.div>

          {/* Upload dropzone preview card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            <Card
              className={`relative border-2 border-dashed p-0 transition-colors ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center sm:py-16">
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}
                  className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/30"
                >
                  <Upload className="h-8 w-8 text-primary" />
                </motion.div>
                <div>
                  <h2 className="text-lg font-semibold">Drag &amp; drop your website here</h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    index.html, any .html file, or a complete .zip project (max 50 MB)
                  </p>
                </div>
                <div className="flex w-full max-w-xs flex-col gap-2 sm:flex-row">
                  <Button className="flex-1" onClick={() => inputRef.current?.click()}>Browse Files</Button>
                </div>
                <input
                  ref={inputRef} type="file" className="hidden" accept=".html,.htm,.zip"
                  onChange={(e) => handleFilePicked(e.target.files)}
                />
                <div className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><FileCode2 className="h-3 w-3" /> .html / .htm</span>
                  <span className="inline-flex items-center gap-1"><FolderArchive className="h-3 w-3" /> .zip projects</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* ---------------- Features ---------------- */}
      <section id="features" className="border-t border-border/60 bg-card/30 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything a real converter needs</h2>
            <p className="mt-3 text-muted-foreground">
              Not a wrapper demo — a complete build pipeline: validation, project generation, Gradle compilation,
              signing and verification.
            </p>
          </motion.div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Cpu, title: 'Real Gradle compilation', text: 'Every build generates a fresh Android project and compiles it with Gradle 8.9 + AGP 8.5 against Android SDK 34. Build logs are real compiler output.' },
              { icon: MonitorSmartphone, title: 'Full WebView control', text: 'JavaScript, DOM storage, zoom, text size, cache modes, mixed content policy, file chooser, downloads, back navigation and external link handling — all configurable.' },
              { icon: ShieldCheck, title: 'Signed & verified APKs', text: 'Debug builds sign automatically. Release builds use your keystore (AES-256-GCM encrypted at rest). Every artifact is verified with apksigner before download.' },
              { icon: Palette, title: 'Your brand, your app', text: 'App name, package name, version, description, launcher icon (all densities generated), splash screen, status/navigation bar colors and orientation.' },
              { icon: HardDrive, title: 'ZIP projects handled safely', text: 'Path-traversal protected extraction, entry-file detection, structure preserved, relative paths intact. No silent file removal.' },
              { icon: Lock, title: 'Secure by default', text: 'Isolated build workspaces, worker timeouts, concurrency limits, rate limiting, ZIP-bomb protection and strict upload validation. Mixed content off unless you allow it.' },
            ].map((f, i) => (
              <motion.div key={f.title} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.05 }}>
                <Card className="group h-full border-border/60 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                  <CardContent className="p-6">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/25 transition-transform group-hover:scale-105">
                      <f.icon className="h-5.5 w-5.5 text-primary" />
                    </div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">From website to APK in four steps</h2>
          </motion.div>
          <div className="mt-12 grid gap-5 md:grid-cols-4">
            {[
              { n: '01', icon: Upload, title: 'Upload', text: 'Drop an .html file or a .zip project. We validate it, scan for external resources and detect your entry page.' },
              { n: '02', icon: Palette, title: 'Configure', text: 'Set app identity, icon, splash, colors, orientation, WebView behavior and only the permissions your app truly needs.' },
              { n: '03', icon: Cpu, title: 'Build', text: 'Our worker generates the Android project and runs the real Gradle build. You watch live compiler logs and honest progress.' },
              { n: '04', icon: Download, title: 'Download', text: 'Grab your verified APK (and optional AAB). Artifacts stay available for 7 days; rebuild any time from your dashboard.' },
            ].map((s, i) => (
              <motion.div key={s.n} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.07 }}>
                <Card className="relative h-full overflow-hidden border-border/60">
                  <CardContent className="p-6">
                    <span className="absolute -top-3 right-3 text-6xl font-black text-primary/10 select-none" aria-hidden>{s.n}</span>
                    <s.icon className="mb-4 h-7 w-7 text-primary" />
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Supported formats ---------------- */}
      <section id="formats" className="border-y border-border/60 bg-card/30 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <motion.div {...fadeUp}>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Supported formats</h2>
              <p className="mt-3 text-muted-foreground">
                Both conversion modes keep your original files, folder structure and relative paths intact.
              </p>
              <div className="mt-8 space-y-4">
                <Card className="border-border/60">
                  <CardContent className="flex items-start gap-4 p-5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/25">
                      <FileCode2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Mode A · Single HTML</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        index.html, any .html or .htm file. Your CSS, JavaScript, images and fonts referenced with
                        relative paths are preserved; remote references stay as-is (internet permission recommended).
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/60">
                  <CardContent className="flex items-start gap-4 p-5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/25">
                      <FolderArchive className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Mode B · ZIP website project</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        Complete static sites: HTML, CSS, JS, images, fonts, icons, audio/video, JSON, local libraries.
                        Entry file auto-detected (index.html) — or select it manually.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
            <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}>
              <h3 className="text-lg font-semibold">Permissions you can grant</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Only the permissions you enable are written into the AndroidManifest. Each one is explained before you allow it.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { icon: Upload, label: 'Internet' },
                  { icon: Camera, label: 'Camera' },
                  { icon: Mic, label: 'Microphone' },
                  { icon: MapPin, label: 'Location' },
                  { icon: HardDrive, label: 'File access' },
                  { icon: Bell, label: 'Notifications' },
                ].map((p) => (
                  <div key={p.label} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background p-3.5">
                    <p.icon className="h-4.5 w-4.5 text-primary" />
                    <span className="text-sm font-medium">{p.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8 rounded-xl border border-primary/25 bg-primary/5 p-5">
                <div className="flex items-start gap-3">
                  <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="text-sm leading-relaxed">
                    <span className="font-semibold">Offline notice:</span> apps load content from files packaged
                    inside the APK. Websites that fetch APIs, CDNs or remote media need an internet connection at
                    runtime — the analyzer warns you when it detects external hosts.
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section id="faq" className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Frequently asked questions</h2>
          </motion.div>
          <motion.div {...fadeUp} className="mt-10">
            <Accordion type="single" collapsible className="w-full">
              {[
                {
                  q: 'Is the APK really compiled from my website?',
                  a: 'Yes. Each build generates a complete Android Gradle project — AndroidManifest.xml, a Java WebView activity, resources, your icon at every density and your site in assets — then runs the actual Gradle build (assembleDebug / assembleRelease) with the Android SDK. If compilation fails you get the compiler errors, not a fake file.',
                },
                {
                  q: 'Do I need to install anything to build?',
                  a: 'No. The Android SDK, JDK and Gradle run on the platform build servers. You only upload files and configure your app. To self-host the platform, see the bundled deployment guide (JDK 17+, Android SDK, Gradle and Docker are documented).',
                },
                {
                  q: 'Debug or release build — which should I choose?',
                  a: 'Debug APKs sign automatically with a debug key — perfect for testing on your device. Release APKs are signed with YOUR keystore, which you generate here or upload. Keep your release keystore and passwords safe: they are required to publish updates to the same app signature.',
                },
                {
                  q: 'My site uses CDNs / APIs / Google Fonts. Will the app work offline?',
                  a: 'Local files are packaged in the APK, but remote resources still need internet at runtime. The analyzer detects external hosts in your HTML/CSS/JS and recommends enabling the Internet permission. Nothing is removed silently.',
                },
                {
                  q: 'What happens to my files and how long are APKs stored?',
                  a: 'Uploads and builds live in isolated per-build workspaces and are treated as untrusted data — never executed server-side. Generated APKs/AABs are retained for 7 days, then automatically deleted. You can delete builds any time from the dashboard.',
                },
                {
                  q: 'How do I install the APK on my phone?',
                  a: 'Download the APK, open it on your Android device and confirm the install prompt (you may need to allow "install from this source" for your browser). Debug and release APKs are regular installable apps. On Android 11+ unknown-source prompts are handled per-app.',
                },
                {
                  q: 'Can I publish my APK to Google Play?',
                  a: 'For Play Store submission use a signed release build (or the optional AAB), with your own keystore. Make sure your website content complies with Play policies — WebView-only apps have specific guidelines.',
                },
              ].map((f) => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger className="text-left text-[15px] font-medium">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp}>
            <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
              <CardContent className="flex flex-col items-center gap-6 px-6 py-14 text-center">
                <Smartphone className="h-10 w-10 text-primary" />
                <h2 className="max-w-xl text-3xl font-bold tracking-tight">Ready to package your website?</h2>
                <p className="max-w-md text-muted-foreground">
                  Upload your first project and watch a real Android build happen in front of you.
                </p>
                <Button size="lg" className="h-12 gap-2 px-8 text-[15px]" onClick={() => onStart(user ? 'upload' : 'auth')}>
                  Start converting <ArrowRight className="h-4.5 w-4.5" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
