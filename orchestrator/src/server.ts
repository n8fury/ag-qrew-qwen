import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { Bus, latestPhase, type Signal } from './bus.js';
import { DB } from './db.js';
import { runSociety } from './agents/qaLead.js';
import type { RunContext } from './agents/worker.js';
import { tokenGuard, validateRunContext, acceptSpecYaml, siteUrlError } from './security.js';
import { demoContext } from './demoPreset.js';
import { detectMode, modeState, NoInputsError, type RunMode } from './mode.js';

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

// Keepalive: proxies (the ECS demo sits behind one) drop idle event streams;
// an SSE comment every 25s keeps the connection warm and is ignored by clients.
setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 25_000).unref();

// ── run state (single active run at a time — this is a demo controller) ─────────
let running = false;
let proceedResolver: (() => void) | null = null;
/**
 * The active (or most-recent) run's detected mode — served by /api/state so the
 * dashboard can render a mode-aware progress bar. Set at run start; a server
 * restart resets it to null, which the bar reads as "unknown mode → show all
 * segments" (pairing with the last-session signal fallback in signalsForDashboard).
 */
let activeMode: RunMode | null = null;

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
  const signals = signalsForDashboard();
  res.json({
    running,
    awaitingProceed: proceedResolver !== null,
    // pipeline position (index/total/id/label) from the latest PHASE signal —
    // survives server restarts via the last-session fallback in signalsForDashboard
    phase: latestPhase(signals),
    // active run's mode (modeId/label/phases) for the mode-aware bar; null after
    // a server restart → bar falls back to all-active rendering
    mode: modeState(activeMode),
    signals,
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

app.post('/api/plan', tokenGuard, (req: Request, res: Response) => {
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

app.post('/api/proceed', tokenGuard, (_req: Request, res: Response) => {
  if (proceedResolver) { proceedResolver(); proceedResolver = null; res.json({ ok: true }); }
  else res.status(409).json({ ok: false, error: 'no checkpoint awaiting' });
});

// ── capability preview (Phase C.1) — no side effects, no token ──────────────────
// The dashboard debounces this as the user edits inputs. It runs detectMode (the
// single source of truth) over the three capability inputs and returns the full
// mode plus per-field validation errors. The empty input set → 400 naming the
// three accepted sources. A present-but-invalid site is reported as a field error
// and treated as absent for the preview (the run itself would reject it loudly).
app.post('/api/preview', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { ctx?: Record<string, unknown>; specProvided?: boolean };
  const raw = (body.ctx ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  let site: string | undefined;
  if (typeof raw.site === 'string' && raw.site.trim() !== '') {
    const err = siteUrlError(raw.site);
    if (err) fieldErrors.site = err;
    else site = raw.site;
  }

  let docText: string | undefined;
  if (typeof raw.docText === 'string' && raw.docText.trim() !== '') {
    if (raw.docText.length > 50_000) fieldErrors.docText = 'requirements document exceeds the 50,000 character limit';
    else docText = raw.docText;
  }

  try {
    const mode = detectMode({ site, docText, spec: Boolean(body.specProvided) });
    res.json({ ok: true, mode, fieldErrors });
  } catch (e) {
    if (e instanceof NoInputsError) {
      res.status(400).json({ ok: false, error: e.message, fieldErrors });
      return;
    }
    throw e;
  }
});

// ── demo preset (Phase C.4) — the bundled target as the default prefill ─────────
// Returns the canonical demo ctx (defined once, in demoPreset.ts) plus the bundled
// OpenAPI spec text, so the dashboard prefills without a second hardcoded copy and
// its "Reset to demo" button just re-fetches this.
app.get('/api/preset', (_req: Request, res: Response) => {
  const bundledSpecPath = fileURLToPath(new URL('../../demo-app/openapi.yaml', import.meta.url));
  const specYaml = existsSync(bundledSpecPath) ? readFileSync(bundledSpecPath, 'utf8') : null;
  res.json({ ctx: demoContext(config.demoAppUrl), specYaml });
});

app.post('/api/run', tokenGuard, (req: Request, res: Response) => {
  if (running) { res.status(409).json({ ok: false, error: 'a run is already in progress' }); return; }

  const bundledSpecPath = fileURLToPath(new URL('../../demo-app/openapi.yaml', import.meta.url));
  const isDemoPreset = req.body?.ctx === undefined;

  // Optional uploaded OpenAPI spec (C.2): ≤1 MB, must document ≥1 path.
  let uploadedSpec: string | null = null;
  if (req.body?.specYaml !== undefined) {
    const s = acceptSpecYaml(req.body.specYaml);
    if (!s.ok) { res.status(400).json({ ok: false, error: `invalid specYaml — ${s.error}` }); return; }
    uploadedSpec = s.text;
  }

  // A spec counts as an input when uploaded, or (demo preset) bundled on disk.
  // Detection judges what was PROVIDED — a custom target with no spec stays
  // spec-less, never silently borrowing the demo's spec.
  const specProvided = Boolean(uploadedSpec) || (isDemoPreset && existsSync(bundledSpecPath));

  // A client-supplied ctx must pass shape + site-URL policy (http(s) only, no
  // metadata/link-local hosts) — without this, /api/run is an SSRF proxy.
  let suppliedCtx: RunContext | undefined;
  if (!isDemoPreset) {
    const v = validateRunContext(req.body.ctx, specProvided);
    if (!v.ok) { res.status(400).json({ ok: false, error: `invalid ctx — ${v.error}` }); return; }
    suppliedCtx = v.ctx;
  }

  running = true;

  // fresh store per run — the dashboard reads all rows unfiltered, so clear the
  // previous run's cases/bugs/disputes/results before a new one starts.
  db.reset();

  // fresh bus per run so the session is clean; re-wire SSE to it.
  bus.off('signal', broadcast);
  bus = new Bus(config.busPath, `web-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  bus.on('signal', broadcast);

  const ctx: RunContext = suppliedCtx ?? demoContext(config.demoAppUrl);

  // Wire the spec so detectMode sees it and qa-api-tester can fs_read it. An
  // uploaded spec is written to qa/openapi.yaml here (before phase 1); the demo
  // preset lets runSociety copy the bundled one. Any client-sent apiSpecPath is
  // ignored unless a real spec backs it (else the api phase would run blind).
  let externalSpecPath: string | undefined;
  if (uploadedSpec) {
    const qaDir = dirname(config.busPath);
    if (!existsSync(qaDir)) mkdirSync(qaDir, { recursive: true });
    writeFileSync(join(qaDir, 'openapi.yaml'), uploadedSpec);
    ctx.apiSpecPath = 'openapi.yaml';
  } else {
    ctx.apiSpecPath = undefined;
    if (isDemoPreset && existsSync(bundledSpecPath)) externalSpecPath = bundledSpecPath;
  }

  // Record the run mode for /api/state (C.3) — the same inputs runSociety detects.
  activeMode = detectMode({
    site: ctx.site, docText: ctx.docText,
    spec: Boolean(ctx.apiSpecPath) || Boolean(externalSpecPath),
  });

  runSociety(ctx, {
    db, bus,
    externalSpecPath,
    autoApprove: false,
    onCheckpoint: () => new Promise<void>((resolve) => { proceedResolver = resolve; }),
    log: (m) => console.log(m),
  })
    .then((r) => console.log(`[web] run finished — verdict ${r.verdict}`))
    .catch((e) => console.error('[web] run failed:', e))
    .finally(() => { running = false; proceedResolver = null; });

  res.json({ ok: true, started: true, mode: modeState(activeMode) });
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
   $('#status').textContent=r.running?(r.awaitingProceed?'awaiting your approval…':(r.phase?r.phase.index+'/'+r.phase.total+' · '+r.phase.label:'running…')):'idle';
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
