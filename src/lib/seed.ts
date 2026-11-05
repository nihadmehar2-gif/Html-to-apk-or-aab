import fs from 'fs';
import path from 'path';
import { config, ensureStorageDirs } from './config';
import { hashPassword } from './auth';
import { db } from './db';

/**
 * Seeds default accounts and a demo project on first run.
 * - admin@html2apk.studio / Admin#2026  (ADMIN)
 * - demo@html2apk.studio  / demo1234    (USER, with one sample ZIP project)
 * Passwords are stored as scrypt hashes; nothing is ever stored in plaintext.
 *
 * Credential seeding is environment-aware:
 *  - H2A_SEED_ADMIN_PASSWORD overrides the default admin password
 *  - in production (NODE_ENV=production) the default demo account is NOT
 *    created unless H2A_SEED_DEMO=true is set explicitly
 */

export const DEMO_CREDENTIALS = { email: 'demo@html2apk.studio', password: 'demo1234' };
export const ADMIN_CREDENTIALS = { email: 'admin@html2apk.studio', password: 'Admin#2026' };

const SAMPLE_FILES: Record<string, string> = {
  'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Task Focus — Sample Web App</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<main class="shell">
  <header class="top">
    <img src="img/logo.svg" alt="logo" width="42" height="42">
    <div><h1>Task Focus</h1><p>A sample offline web project packaged by HTML2APK Studio</p></div>
  </header>
  <section class="card">
    <form id="add"><input id="task" placeholder="Add a task…" autocomplete="off"><button type="submit">Add</button></form>
    <ul id="list"></ul>
    <footer><span id="count">0 tasks</span><span id="clock">--:--:--</span></footer>
  </section>
  <script src="js/app.js"></script>
</main>
</body>
</html>
`,
  'css/style.css': `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.shell{width:100%;max-width:420px}
.top{display:flex;gap:12px;align-items:center;margin-bottom:20px}
.top h1{font-size:22px;color:#10b981}
.top p{font-size:12px;color:#94a3b8}
.card{background:#1e293b;border-radius:16px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
form{display:flex;gap:8px;margin-bottom:14px}
input{flex:1;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;color:#e2e8f0;font-size:14px}
button{background:#10b981;border:none;border-radius:10px;padding:12px 18px;color:#052e1f;font-weight:700;cursor:pointer}
ul{list-style:none;display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto}
li{background:#0f172a;padding:12px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;font-size:14px}
li.done span{text-decoration:line-through;color:#64748b}
footer{display:flex;justify-content:space-between;margin-top:14px;font-size:12px;color:#64748b}
`,
  'js/app.js': `const list = document.getElementById('list');
const form = document.getElementById('add');
const taskInput = document.getElementById('task');
const count = document.getElementById('count');
let tasks = [];
try { tasks = JSON.parse(localStorage.getItem('tasks') || '[]'); } catch (e) { tasks = []; }
function render() {
  list.innerHTML = '';
  tasks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = t.done ? 'done' : '';
    li.innerHTML = '<span>' + t.text + '</span>';
    const btn = document.createElement('button');
    btn.textContent = t.done ? '↺' : '✓';
    btn.onclick = () => { tasks[i].done = !tasks[i].done; save(); };
    li.appendChild(btn);
    list.appendChild(li);
  });
  count.textContent = tasks.filter(t => !t.done).length + ' tasks left';
}
function save() { localStorage.setItem('tasks', JSON.stringify(tasks)); render(); }
form.onsubmit = (e) => { e.preventDefault(); const v = taskInput.value.trim(); if (!v) return; tasks.unshift({ text: v, done: false }); taskInput.value = ''; save(); };
setInterval(() => { document.getElementById('clock').textContent = new Date().toLocaleTimeString(); }, 1000);
render();
`,
  'img/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#10b981"/><path d="M14 24l7 7 13-14" stroke="#052e1f" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
`,
};

let seedPromise: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seedPromise) seedPromise = doSeed();
  return seedPromise;
}

async function doSeed(): Promise<void> {
  ensureStorageDirs();
  const flag = await db.setting.findUnique({ where: { key: 'seeded' } });
  if (flag) return;

  try {
    // Admin account — password overridable via env for real deployments
    const adminPassword = process.env.H2A_SEED_ADMIN_PASSWORD || ADMIN_CREDENTIALS.password;
    if (!(await db.user.findUnique({ where: { email: ADMIN_CREDENTIALS.email } }))) {
      await db.user.create({
        data: {
          email: ADMIN_CREDENTIALS.email,
          name: 'Platform Admin',
          passwordHash: hashPassword(adminPassword),
          role: 'ADMIN',
        },
      });
    }

    // Demo account with a ready-to-build sample ZIP project.
    // Only seeded in non-production environments unless H2A_SEED_DEMO=true.
    const wantDemo = process.env.NODE_ENV !== 'production' || process.env.H2A_SEED_DEMO === 'true';
    let demo = await db.user.findUnique({ where: { email: DEMO_CREDENTIALS.email } });
    if (!demo && wantDemo) {
      demo = await db.user.create({
        data: {
          email: DEMO_CREDENTIALS.email,
          name: 'Demo User',
          passwordHash: hashPassword(DEMO_CREDENTIALS.password),
          role: 'USER',
        },
      });
    }

    if (demo) {
      const hasSample = await db.project.findFirst({ where: { userId: demo.id, name: 'Task Focus (sample)' } });
      if (!hasSample) {
        const uploadId = 'sample-taskfocus';
        const dir = path.join(config.uploadsDir, uploadId);
        fs.mkdirSync(dir, { recursive: true });
        for (const [rel, content] of Object.entries(SAMPLE_FILES)) {
          const p = path.join(dir, rel);
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, content);
        }
        // The build worker consumes projects as original.zip — build a real
        // archive from the sample files so the demo account can build+download.
        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip();
        for (const rel of Object.keys(SAMPLE_FILES)) {
          zip.addLocalFile(path.join(dir, rel), path.dirname(rel) === '.' ? '' : path.dirname(rel));
        }
        const zipBuf = zip.toBuffer();
        fs.writeFileSync(path.join(dir, 'original.zip'), zipBuf);
        const totalSize = Object.values(SAMPLE_FILES).reduce((a, c) => a + Buffer.byteLength(c), 0);
        await db.project.create({
          data: {
            userId: demo.id,
            name: 'Task Focus (sample)',
            sourceType: 'ZIP',
            originalName: 'task-focus-sample.zip',
            size: zipBuf.length,
            fileCount: Object.keys(SAMPLE_FILES).length,
            entryPath: 'index.html',
            storagePath: dir,
          },
        });
        void totalSize; // informational only
      }
    }

    await db.setting.create({ data: { key: 'seeded', value: new Date().toISOString() } });
    console.log('[seed] default accounts + sample project ready');
  } catch (e) {
    // concurrent seed race — ignore if another process seeded first
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('Unique constraint')) {
      console.error('[seed] failed:', msg);
    }
    try {
      await db.setting.create({ data: { key: 'seeded', value: new Date().toISOString() } });
    } catch { /* already exists */ }
  }
}
