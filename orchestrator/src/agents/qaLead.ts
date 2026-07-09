import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { config } from '../config.js';
import { Bus, type Signal } from '../bus.js';
import { DB, type Bug, type Dispute } from '../db.js';
import { adjudicate } from '../adjudicate.js';
import type { ToolDeps } from '../tools/index.js';
import {
  runAgent, metaPayload,
  testPlanTask, hawkEnvTask, tcWriterTask, apiTesterTask, scriptWriterTask, hawkExploreTask, signOffTask,
  type RunContext,
} from './worker.js';
import type { AgentOutcome } from '../agentLoop.js';

/**
 * The QA-society orchestrator (plan task 3). Deterministic control flow around
 * the AgentLoop workers:
 *
 *   Phase 0  env gate — run qa-hawk (mode: environment); a BLOCKED HAWK-ENV halts.
 *   Phase 1  test plan — run qa-lead (Mode 1); write qa/test-plan-sprint{N}.txt.
 *   ── proceed checkpoint (the one human gate) ──
 *   Phase 2  execution — workers in dependency order:
 *              group A (parallel): qa-tc-writer + qa-api-tester
 *              group B (parallel): qa-script-writer + qa-hawk (explore)
 *            B reads the cases A stored via tc_list, so A must finish first.
 *            (AgentLoop is a synchronous request/response loop with no background
 *             wait primitive — ordering the groups is how we honour the
 *             TC-READY → consume dependency deterministically.)
 *   Phase 3  adjudication — drain db.openDisputes() → adjudicate() each (Track-3).
 *   Phase 4  sign-off — run qa-lead (Mode 2); compute the deterministic verdict.
 */

export interface SocietyOptions {
  db?: DB;
  bus?: Bus;
  session?: string;
  externalSpecPath?: string;     // a real fs path to an OpenAPI spec; copied into qa/
  autoApprove?: boolean;         // default true — skip the human proceed gate
  enforceEnvGate?: boolean;      // default true — a BLOCKED env halts the run
  onCheckpoint?: (planFile: string) => Promise<void>;
  log?: (msg: string) => void;
}

export interface Metrics {
  mode: 'society' | 'single';
  wallClockMs: number;
  totalTokens: number;
  bugs: number;
  disputes: number;
  testCases: number;
  results: { pass: number; fail: number; blocked: number; skip: number };
  verdict: string;
}

export interface SocietyResult {
  runId: number;
  verdict: string;
  bugs: Bug[];
  disputes: Dispute[];
  blockers: Signal[];
  outcomes: AgentOutcome[];
  metrics: Metrics;
}

const noop = () => {};

export async function runSociety(ctx: RunContext, opts: SocietyOptions = {}): Promise<SocietyResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const autoApprove = opts.autoApprove ?? true;
  const enforceEnvGate = opts.enforceEnvGate ?? true;

  const qaRoot = resolve(dirname(config.busPath));
  if (!existsSync(qaRoot)) mkdirSync(qaRoot, { recursive: true });

  // Make the site URL visible to specs that playwright_run executes as child
  // processes — they read process.env.SITE_URL and inherit this env.
  process.env.SITE_URL = ctx.site;

  const session = opts.session ?? `society-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const bus = opts.bus ?? new Bus(config.busPath, session);
  const db = opts.db ?? new DB(config.dbPath);
  const deps: ToolDeps = { db, bus, qaRoot };
  const outcomes: AgentOutcome[] = [];

  // Copy an external OpenAPI spec into the qa/ sandbox so qa-api-tester can fs_read it.
  if (opts.externalSpecPath && existsSync(opts.externalSpecPath)) {
    const target = join(qaRoot, 'openapi.yaml');
    writeFileSync(target, readFileSync(opts.externalSpecPath, 'utf8'));
    ctx.apiSpecPath = 'openapi.yaml';
    log(`[setup] copied ${opts.externalSpecPath} → qa/openapi.yaml`);
  }

  const started = Date.now();
  const runId = db.startRun('society', `${ctx.project} sprint ${ctx.sprint}`);
  bus.write('META', metaPayload(ctx), 'qa-lead');
  log(`[run #${runId}] society mode — ${ctx.project} sprint ${ctx.sprint} — modules: ${ctx.modules.join(', ')}`);

  // ── Phase 0 — environment gate ──────────────────────────────────────────────
  log('[phase 0] environment validation (qa-hawk)…');
  outcomes.push(await runAgent('qa-hawk', deps, hawkEnvTask(ctx), { maxIterations: 20 }));
  const env = latest(bus, 'HAWK-ENV');
  if (env && /BLOCKED/i.test(env.payload)) {
    log(`[phase 0] env BLOCKED: ${env.payload}`);
    if (enforceEnvGate) {
      return finalize(db, bus, runId, started, outcomes, qaRoot, log, 'FAIL (environment blocked)');
    }
    log('[phase 0] enforceEnvGate=false → continuing despite blocker.');
  } else {
    log(`[phase 0] env: ${env?.payload ?? 'no HAWK-ENV signal — proceeding'}`);
  }

  // ── Phase 1 — test plan ─────────────────────────────────────────────────────
  log('[phase 1] test plan (qa-lead)…');
  outcomes.push(await runAgent('qa-lead', deps, testPlanTask(ctx), { maxIterations: 20 }));
  const planFile = `test-plan-sprint${ctx.sprint}.txt`;

  // ── proceed checkpoint ──────────────────────────────────────────────────────
  if (opts.onCheckpoint) {
    log('[checkpoint] awaiting approval of the test plan…');
    await opts.onCheckpoint(planFile);
  } else if (!autoApprove) {
    log(`[checkpoint] test plan written to qa/${planFile}. Auto-approve is off and no gate supplied — proceeding.`);
  } else {
    log('[checkpoint] auto-approved.');
  }

  // ── Phase 2 — execution (topologically ordered) ─────────────────────────────
  //  2a: qa-tc-writer alone — it produces the cases everyone downstream consumes.
  //  2b: qa-script-writer + qa-hawk (parallel) — both read cases via tc_list; hawk
  //      files the UI/exploratory bugs.
  //  2c: qa-api-tester last — it reads BUG-FILED and can dispute a UI finding with
  //      its API evidence (the disputing agent MUST run after the one it challenges).
  log('[phase 2a] qa-tc-writer…');
  outcomes.push(await runAgent('qa-tc-writer', deps, tcWriterTask(ctx)));

  // Sequential, not Promise.all: two workers sharing one model bucket in parallel
  // trip the free tier's per-minute token window (serial execution was the plan's
  // designated fallback — the signal bus makes the coordination order-independent).
  log('[phase 2b] qa-script-writer, then qa-hawk explore…');
  outcomes.push(await runAgent('qa-script-writer', deps, scriptWriterTask(ctx)));
  // hawk's vision calls are token-heavy (each screenshot → qwen-vl) — larger budget
  outcomes.push(await runAgent('qa-hawk', deps, hawkExploreTask(ctx), { maxTokens: 350_000 }));

  log('[phase 2c] qa-api-tester (probes API, may dispute UI findings)…');
  outcomes.push(await runAgent('qa-api-tester', deps, apiTesterTask(ctx)));

  // ── Phase 3 — dispute adjudication (Track-3) ────────────────────────────────
  const open = db.openDisputes();
  log(`[phase 3] adjudicating ${open.length} dispute(s)…`);
  for (const d of open) {
    try {
      const a = await adjudicate(d, db, bus);
      log(`  dispute #${d.id} on bug #${d.bug_id} → ${a.verdict}`);
    } catch (err: any) {
      log(`  dispute #${d.id} adjudication error: ${err.message}`);
    }
  }

  // ── Phase 4 — sign-off ──────────────────────────────────────────────────────
  log('[phase 4] sign-off (qa-lead)…');
  const summary = buildSummary(db, bus);
  outcomes.push(await runAgent('qa-lead', deps, signOffTask(ctx, summary), { maxIterations: 20 }));

  const verdict = computeVerdict(db, bus);
  return finalize(db, bus, runId, started, outcomes, qaRoot, log, verdict);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function latest(bus: Bus, type: Signal['type']): Signal | undefined {
  return bus.readAll().filter((s) => s.type === type).at(-1);
}

/** Bugs excluded because a dispute REJECTED them; used by the verdict + summary. */
function rejectedBugIds(db: DB): Set<number> {
  const out = new Set<number>();
  for (const d of db.listDisputes()) if (d.verdict === 'REJECTED') out.add(d.bug_id);
  return out;
}

function effectiveBugs(db: DB): Bug[] {
  const rejected = rejectedBugIds(db);
  return db.listBugs().filter((b) => !rejected.has(b.id!));
}

function tallyResults(db: DB) {
  const t = { pass: 0, fail: 0, blocked: 0, skip: 0 };
  for (const r of db.results() as { status: string }[]) {
    if (r.status === 'PASS') t.pass++;
    else if (r.status === 'FAIL') t.fail++;
    else if (r.status === 'BLOCKED') t.blocked++;
    else if (r.status === 'SKIP') t.skip++;
  }
  return t;
}

/** Deterministic verdict — the source of truth for RunResult (the LLM writes the narrative). */
export function computeVerdict(db: DB, bus: Bus): string {
  const bugs = effectiveBugs(db);
  const crit = bugs.filter((b) => b.severity === 'Critical').length;
  const high = bugs.filter((b) => b.severity === 'High').length;
  const unresolved = db.openDisputes().length;
  const blockers = bus.blockers().length;
  if (crit > 0 || blockers > 0 || unresolved > 0 || high > 2) return 'FAIL';
  if (high >= 1) return 'CONDITIONAL PASS';
  return 'PASS';
}

function buildSummary(db: DB, bus: Bus): string {
  const bugs = effectiveBugs(db);
  const bySev = (s: Bug['severity']) => bugs.filter((b) => b.severity === s).length;
  const disputes = db.listDisputes();
  const t = tallyResults(db);
  const lines: string[] = [];
  lines.push(`Bugs (after adjudication): ${bugs.length} — Critical ${bySev('Critical')}, High ${bySev('High')}, Medium ${bySev('Medium')}, Low ${bySev('Low')}`);
  for (const b of bugs) lines.push(`  #${b.id} [${b.severity}] (${b.module}) ${b.title} — found by ${b.found_by}`);
  lines.push(`Results: ${t.pass} pass, ${t.fail} fail, ${t.blocked} blocked, ${t.skip} skip (total cases stored: ${db.listCases().length})`);
  if (disputes.length) {
    lines.push(`Disputes:`);
    for (const d of disputes) lines.push(`  #${d.id} bug #${d.bug_id}: ${d.raised_by} vs ${d.challenged_by} → ${d.verdict ?? 'OPEN'} — ${d.rationale ?? ''}`);
  } else {
    lines.push(`Disputes: none raised.`);
  }
  const blockers = bus.blockers();
  lines.push(`Outstanding BLOCKED signals: ${blockers.length}${blockers.length ? ' — ' + blockers.map((b) => b.payload).join('; ') : ''}`);
  return lines.join('\n');
}

function finalize(
  db: DB, bus: Bus, runId: number, started: number,
  outcomes: AgentOutcome[], qaRoot: string, log: (m: string) => void, verdict: string,
): SocietyResult {
  db.finishRun(runId, verdict);
  const bugs = effectiveBugs(db);
  const metrics: Metrics = {
    mode: 'society',
    wallClockMs: Date.now() - started,
    totalTokens: outcomes.reduce((s, o) => s + o.tokens, 0),
    bugs: bugs.length,
    disputes: db.listDisputes().length,
    testCases: db.listCases().length,
    results: tallyResults(db),
    verdict,
  };
  writeMetrics(qaRoot, metrics);
  log(`[done] verdict: ${verdict} — ${metrics.bugs} bugs, ${metrics.disputes} disputes, ${metrics.testCases} cases, ${metrics.totalTokens} tokens, ${Math.round(metrics.wallClockMs / 1000)}s`);
  return { runId, verdict, bugs, disputes: db.listDisputes(), blockers: bus.blockers(), outcomes, metrics };
}

/** Merge a mode's metrics into qa/metrics.json (society + single share the file, keyed by mode). */
export function writeMetrics(qaRoot: string, metrics: Metrics) {
  const path = join(qaRoot, 'metrics.json');
  let obj: Record<string, unknown> = {};
  if (existsSync(path)) { try { obj = JSON.parse(readFileSync(path, 'utf8')); } catch { obj = {}; } }
  obj[metrics.mode] = metrics;
  writeFileSync(path, JSON.stringify(obj, null, 2));
}
