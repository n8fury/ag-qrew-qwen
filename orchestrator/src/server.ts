import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { Bus, type Signal } from './bus.js';
import { DB } from './db.js';
import { runSociety } from './agents/qaLead.js';
import type { RunContext } from './agents/worker.js';

/**
 * Server (plan task 8) — Express + SSE. Streams the signal bus live, exposes the
 * store (cases / bugs / disputes / results) as JSON, starts a run, and serves the
 * one `proceed` checkpoint via a button. A minimal inline dashboard is served at
 * `/` so the pipeline is watchable with no build step (the full React dashboard is
 * plan task 9). All read endpoints work before/after a run; SSE carries it live.
 */

const app = express();
app.use(express.json());

const db = new DB(config.dbPath);
let bus = new Bus(config.busPath, `web-${new Date().toISOString().replace(/[:.]/g, '-')}`);

const sseClients = new Set<Response>();
function broadcast(sig: Signal) {
  const line = `data: ${JSON.stringify(sig)}\n\n`;
  for (const res of sseClients) res.write(line);
}
bus.on('signal', broadcast);

// ── run state (single active run at a time — this is a demo controller) ─────────
let running = false;
let proceedResolver: (() => void) | null = null;

/**
 * Signals for the dashboard: the live session's, or — when the server was
 * (re)started after a run (fresh session, zero signals) — the last session on
 * file, so the feed still shows the completed run instead of an empty pane.
 */
function signalsForDashboard(): Signal[] {
  const live = bus.readAll();
  if (live.length > 0 || !existsSync(config.busPath)) return live;
  const all = readFileSync(config.busPath, 'utf8')
    .split('\n')
    .map((l) => Bus.parse(l.trim()))
    .filter((s): s is Signal => s !== null);
  if (all.length === 0) return [];
  const lastSession = all[all.length - 1].session;
  return all.filter((s) => s.session === lastSession);
}

app.get('/api/state', (_req: Request, res: Response) => {
  res.json({
    running,
    awaitingProceed: proceedResolver !== null,
    signals: signalsForDashboard(),
    cases: db.listCases(),
    bugs: db.listBugs(),
    disputes: db.listDisputes(),
    results: db.results(),
  });
});

app.get('/api/stream', (req: Request, res: Response) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'HELLO', payload: 'connected' })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Sign-off report + metrics for the React dashboard's sign-off view. Both are
// plain files the QA Lead writes into qa/ — read fresh on every request.
app.get('/api/report', (_req: Request, res: Response) => {
  const qaDir = dirname(config.busPath);
  const readIf = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  let metrics: unknown = null;
  try { metrics = JSON.parse(readIf(join(qaDir, 'metrics.json')) ?? 'null'); } catch { /* mid-write */ }
  res.json({ signOff: readIf(join(qaDir, 'sign-off-report.txt')), metrics });
});

// Test plan — view/edit from the dashboard. The file path is server-controlled
// (latest qa/test-plan-sprint*.txt); the client only ever sends content, so this
// is not an arbitrary-write endpoint. Editing is most meaningful while the run is
// paused at the proceed checkpoint: workers fs_read the plan AFTER approval.
function latestPlanFile(): string | null {
  const qaDir = dirname(config.busPath);
  if (!existsSync(qaDir)) return null;
  const plans = readdirSync(qaDir)
    .filter((f) => /^test-plan-sprint\d+\.txt$/.test(f))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  return plans.length ? join(qaDir, plans[0]) : null;
}

app.get('/api/plan', (_req: Request, res: Response) => {
  const file = latestPlanFile();
  if (!file) { res.json({ file: null, content: null, editable: false }); return; }
  res.json({
    file: file.split(/[\\/]/).pop(),
    content: readFileSync(file, 'utf8'),
    // editable any time, but the checkpoint is when edits shape the run
    editable: true,
    awaitingProceed: proceedResolver !== null,
  });
});

app.post('/api/plan', (req: Request, res: Response) => {
  const file = latestPlanFile();
  if (!file) { res.status(404).json({ ok: false, error: 'no test plan on disk yet' }); return; }
  const content = req.body?.content;
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ ok: false, error: 'body must be { content: string } (non-empty)' });
    return;
  }
  writeFileSync(file, content);
  res.json({ ok: true, file: file.split(/[\\/]/).pop() });
});

app.post('/api/proceed', (_req: Request, res: Response) => {
  if (proceedResolver) { proceedResolver(); proceedResolver = null; res.json({ ok: true }); }
  else res.status(409).json({ ok: false, error: 'no checkpoint awaiting' });
});

app.post('/api/run', (req: Request, res: Response) => {
  if (running) { res.status(409).json({ ok: false, error: 'a run is already in progress' }); return; }
  running = true;

  // fresh store per run — the dashboard reads all rows unfiltered, so clear the
  // previous run's cases/bugs/disputes/results before a new one starts.
  db.reset();

  // fresh bus per run so the session is clean; re-wire SSE to it.
  bus.off('signal', broadcast);
  bus = new Bus(config.busPath, `web-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  bus.on('signal', broadcast);

  const specPath = fileURLToPath(new URL('../../demo-app/openapi.yaml', import.meta.url));
  const ctx: RunContext = req.body?.ctx ?? {
    project: 'Demo Task Manager', sprint: 1, site: config.demoAppUrl,
    modules: ['auth', 'tasks'],
    creds: { adminEmail: 'admin@demo.test', adminPassword: 'admin123', userEmail: 'user@demo.test', userPassword: 'user123' },
    docText: 'Sprint 1 — Demo Task Manager: login + task CRUD; title required, max 200 chars; over-length/missing title → 400. Entry points: sign-in page is the root page (/), tasks page at /tasks, REST API under /api (auth: POST /api/auth/login).',
    siteMap: 'login UI = / (root page, email+password form) · tasks UI = /tasks · REST API under /api per the OpenAPI spec (auth: POST /api/auth/login)',
  };

  runSociety(ctx, {
    db, bus,
    externalSpecPath: existsSync(specPath) ? specPath : undefined,
    autoApprove: false,
    onCheckpoint: () => new Promise<void>((resolve) => { proceedResolver = resolve; }),
    log: (m) => console.log(m),
  })
    .then((r) => console.log(`[web] run finished — verdict ${r.verdict}`))
    .catch((e) => console.error('[web] run failed:', e))
    .finally(() => { running = false; proceedResolver = null; });

  res.json({ ok: true, started: true });
});

// Serve the full dashboard build if present, else the inline mini-dashboard.
// Check index.html, not just the dir — an empty Docker bind mount must fall back.
const dashboardDist = fileURLToPath(new URL('../../dashboard/dist', import.meta.url));
if (existsSync(join(dashboardDist, 'index.html'))) {
  app.use(express.static(dashboardDist));
} else {
  app.get('/', (_req: Request, res: Response) => res.type('html').send(MINI_DASHBOARD));
}

app.listen(config.server.port, () => {
  console.log(`AG-QREW server on http://localhost:${config.server.port}`);
  console.log(`  GET /  → live dashboard   POST /api/run → start   POST /api/proceed → approve plan`);
});

const MINI_DASHBOARD = `<!doctype html><html><head><meta charset="utf8"><title>AG-QREW on Qwen</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#0f1117;color:#e6e6e6}
 header{padding:12px 20px;background:#161923;display:flex;gap:12px;align-items:center;border-bottom:1px solid #262a36}
 button{background:#3b82f6;color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:600}
 button:disabled{opacity:.4;cursor:not-allowed} button.warn{background:#f59e0b}
 main{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}
 section{background:#161923;border:1px solid #262a36;border-radius:8px;padding:12px;max-height:70vh;overflow:auto}
 h2{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#93a1b5}
 .sig{font-family:ui-monospace,monospace;font-size:12px;padding:2px 0;border-bottom:1px solid #1e2230;white-space:pre-wrap}
 .t{display:inline-block;min-width:96px;font-weight:700} .BUG-FILED{color:#f87171}.DONE{color:#34d399}.BLOCKED{color:#fbbf24}
 .DISPUTE{color:#c084fc}.RESOLVED{color:#a78bfa}.TC-READY{color:#60a5fa}.META{color:#6b7280}
 .bug{border-left:3px solid #f87171;padding:4px 8px;margin:6px 0;background:#1b1e28}
 .sev{font-weight:700} .Critical{color:#f87171}.High{color:#fb923c}.Medium{color:#fbbf24}.Low{color:#9ca3af}
 code{color:#93a1b5}
</style></head><body>
<header>
 <strong>AG-QREW on Qwen</strong>
 <button id="run">▶ Start run</button>
 <button id="proceed" class="warn" disabled>✓ Approve test plan (proceed)</button>
 <span id="status" style="color:#93a1b5"></span>
</header>
<main>
 <section><h2>Signal bus (live)</h2><div id="signals"></div></section>
 <section><h2>Bugs &amp; disputes</h2><div id="bugs"></div><div id="disputes"></div></section>
 <section style="grid-column:1/-1"><h2>Test cases (SQLite · tc_store)</h2><div id="cases"></div></section>
</main>
<script>
 const $=s=>document.querySelector(s);
 function esc(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
 function renderSig(s){const d=document.createElement('div');d.className='sig';
   d.innerHTML='<span class="t '+s.type+'">'+s.type+'</span> '+esc(s.payload||'')+' <code>'+(s.from||'')+'</code>';
   $('#signals').prepend(d);}
 async function refresh(){const r=await fetch('/api/state').then(r=>r.json());
   $('#proceed').disabled=!r.awaitingProceed; $('#run').disabled=r.running;
   $('#status').textContent=r.running?(r.awaitingProceed?'awaiting your approval…':'running…'):'idle';
   $('#bugs').innerHTML=r.bugs.map(b=>'<div class="bug"><span class="sev '+b.severity+'">'+b.severity+'</span> '
     +esc(b.title)+' <code>('+b.module+', by '+b.found_by+')</code></div>').join('')||'<em>no bugs yet</em>';
   $('#disputes').innerHTML=r.disputes.map(d=>'<div class="bug" style="border-color:#c084fc">DISPUTE #'+d.id
     +' bug #'+d.bug_id+': '+esc(d.raised_by)+' vs '+esc(d.challenged_by)+' → <b>'+(d.verdict||'OPEN')+'</b></div>').join('');
   $('#cases').innerHTML=r.cases.length?r.cases.map(c=>'<div class="sig"><span class="t TC-READY">#'+c.id+' '+esc(c.tc_ref||'')
     +'</span> <b>['+esc(c.module)+']</b> '+esc(c.title)+' <code>('+esc(c.type)+', '+esc(c.priority)+')</code></div>').join(''):'<em>no test cases stored yet — run the pipeline</em>';}
 $('#run').onclick=async()=>{await fetch('/api/run',{method:'POST'});refresh();};
 $('#proceed').onclick=async()=>{await fetch('/api/proceed',{method:'POST'});refresh();};
 const es=new EventSource('/api/stream');
 es.onmessage=e=>{const s=JSON.parse(e.data); if(s.type&&s.type!=='HELLO'){renderSig(s);refresh();}};
 refresh(); setInterval(refresh,4000);
</script></body></html>`;
