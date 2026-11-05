'use client';

import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  UploadCloud, FileCode2, FolderArchive, X, Loader2, Globe, FileWarning,
  CheckCircle2, ArrowRight, Home, FileText, Images, Languages, Database, Music,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from './api';
import { formatBytes, type UploadResult } from './types';

export function UploadView({
  onUploaded,
  onPickExisting,
}: {
  onUploaded: (res: UploadResult) => void;
  onPickExisting: () => void;
}) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [entryChoice, setEntryChoice] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = '.html,.htm,.zip';

  const processFile = useCallback(async (f: File) => {
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.html') && !lower.endsWith('.htm') && !lower.endsWith('.zip')) {
      toast({ title: 'Unsupported file', description: 'Upload an .html/.htm file or a .zip website project.', variant: 'destructive' });
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast({ title: 'File too large', description: `Maximum upload size is 50 MB (your file is ${formatBytes(f.size)}).`, variant: 'destructive' });
      return;
    }
    setFile(f);
    setResult(null);
    setUploading(true);
    try {
      const res = await api.upload(f);
      setResult(res);
      setEntryChoice(res.analysis.entryPath || '');
      toast({ title: 'Project validated', description: `${res.filename} · ${res.analysis.fileCount} file(s) analyzed` });
    } catch (e) {
      setFile(null);
      toast({
        title: 'Upload rejected',
        description: e instanceof ApiError ? e.message : 'Upload failed. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }, [toast]);

  return (
    <main className="flex-1 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Upload your project</h1>
          <p className="mt-2 text-muted-foreground">
            Single HTML file or a complete ZIP website — the analyzer will validate it before building.
          </p>
        </div>

        {/* Mode cards */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <Card className={`border-border/60 ${file?.name.toLowerCase().endsWith('.zip') === false ? 'border-primary/50' : ''}`}>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/25"><FileCode2 className="h-5 w-5 text-primary" /></div>
              <div>
                <h3 className="text-sm font-semibold">Mode A · Single HTML</h3>
                <p className="text-xs text-muted-foreground">.html / .htm file with relative assets</p>
              </div>
            </CardContent>
          </Card>
          <Card className={`border-border/60 ${file?.name.toLowerCase().endsWith('.zip') ? 'border-primary/50' : ''}`}>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/25"><FolderArchive className="h-5 w-5 text-primary" /></div>
              <div>
                <h3 className="text-sm font-semibold">Mode B · ZIP project</h3>
                <p className="text-xs text-muted-foreground">Full site with CSS, JS, images, fonts…</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dropzone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload area"
          className={`flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
            dragOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50'}`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void processFile(f); }}
        >
          <input ref={inputRef} type="file" className="hidden" accept={accept}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void processFile(f); e.target.value = ''; }} />
          {uploading ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">Validating {file?.name}…</p>
              <p className="text-xs text-muted-foreground">Checking archive safety, entry file and external references</p>
            </>
          ) : file && !result ? (
            <p className="text-sm text-muted-foreground">Processing…</p>
          ) : !file ? (
            <>
              <UploadCloud className="h-10 w-10 text-primary" />
              <div>
                <p className="font-medium">Drag &amp; drop or <span className="text-primary">browse files</span></p>
                <p className="mt-1 text-xs text-muted-foreground">.html, .htm or .zip · up to 50 MB</p>
              </div>
            </>
          ) : null}
        </div>

        {/* Selected file */}
        {file && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
            {file.name.toLowerCase().endsWith('.zip')
              ? <FolderArchive className="h-8 w-8 shrink-0 text-primary" />
              : <FileText className="h-8 w-8 shrink-0 text-primary" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            {!uploading && (
              <Button variant="ghost" size="icon" aria-label="Remove file"
                onClick={() => { setFile(null); setResult(null); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {/* Analysis result */}
        {result && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/5 text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" /> Valid {result.kind === 'ZIP' ? 'ZIP project' : 'HTML document'}
              </Badge>
              <Badge variant="secondary">{result.analysis.fileCount} files</Badge>
              <Badge variant="secondary">{formatBytes(result.analysis.totalBytes)} unpacked</Badge>
              {Object.entries(result.analysis.assetSummary).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-muted-foreground">{v} {k}</Badge>
              ))}
            </div>

            {result.analysis.warnings.map((w, i) => (
              <Alert key={i} className="border-amber-500/40 bg-amber-500/5">
                {w.toLowerCase().includes('external') ? <Globe className="h-4 w-4 text-amber-500" /> : <FileWarning className="h-4 w-4 text-amber-500" />}
                <AlertTitle>Heads up</AlertTitle>
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            {/* Entry file selection */}
            {result.kind === 'ZIP' && result.analysis.htmlFiles.length > 0 && (
              <Card className="border-border/60">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Entry HTML file</h3>
                      <p className="text-xs text-muted-foreground">
                        {result.analysis.entryPath
                          ? `Auto-detected: ${result.analysis.entryPath}. You can pick a different page.`
                          : 'No index.html found — select which page the app should open.'}
                      </p>
                    </div>
                    <Select value={entryChoice} onValueChange={setEntryChoice}>
                      <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Select entry page" /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {result.analysis.htmlFiles.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onPickExisting}>Use a project from my dashboard</Button>
              <Button className="gap-2" disabled={!entryChoice}
                onClick={() => onUploaded({ ...result, analysis: { ...result.analysis, entryPath: entryChoice } })}>
                Configure app <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Sample hint */}
        {!file && (
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Home className="h-3.5 w-3.5" /> Tip: the demo account has a ready sample project you can build instantly.
          </div>
        )}
      </div>
    </main>
  );
}
