import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { config } from '../config.js';
import { Bus } from '../bus.js';
import { DB } from '../db.js';
import { AgentLoop } from '../agentLoop.js';
import { allTools } from '../tools/index.js';
import { writeMetrics, type Metrics } from '../agents/qaLead.js';
import { detectMode } from '../mode.js';
import { metaPayload, type RunContext } from '../agents/worker.js';

/**
 * Single-agent baseline (plan task 7 — the Track-3 comparison point). The exact
 * same job as the society, but ONE monolithic AgentLoop holding every tool. It
 * emits qa/metrics.json under the "single" key so the README can table it
 * against the society run (wall-clock, tokens, bugs found, cases, disputes).
 * There is no second agent, so no dispute is ever raised — that absence is
 * itself a finding: conflict resolution is a property of the society, not the solo.
 */

const SINGLE_AGENT_PROMPT = `You are a solo QA engineer. You alone must plan, write test cases, test the API,
generate and run browser automation, explore for defects, and produce a sign-off report — the entire
sprint, with no teammates. You have one shared toolbox; use whichever tool each step needs.

Tools:
- bus_write / bus_read — a shared task log; record your milestones as PROGRESS and finish with DONE.
- fs_write / fs_read — read/write plain-text artefacts under qa/ (test plan, results, reports).
- tc_store — persist test cases per module (this is your test-case store). tc_list — read them back (note each row id).
- http_request — probe the REST API directly (status + body). Read the BODY, not just the status: a 200 with an error body is a bug.
- playwright_run — run a standalone Playwright-as-a-library tsx script under qa/ (exit 0 = pass). Write specs, then run them.
- browser_snapshot — screenshot a URL and get a vision analysis of what the page shows (layout defects, wrong text, stale data).
- result_record — record PASS/FAIL/BLOCKED against a stored case by row id.
- bug_file — file a defect (title, severity, module, oracle [FEW HICCUPPS], steps, expected, actual, evidence).

Work in this order, silently (never address the user, never ask questions — take the conservative interpretation and proceed):
1. Read the source document and any spec (fs_read qa/openapi.yaml if present). Write a short test plan to qa/test-plan-sprint1.txt.
2. For each module, write test cases and tc_store them.
3. Test every API endpoint from the spec: happy path, auth-matrix negatives, validation negatives, boundary values. Judge each response against the spec; result_record and bug_file every mismatch.
4. Explore the UI with browser_snapshot for visual/text/stale-data defects; optionally write and playwright_run a spec for a core flow.
5. Apply the FEW HICCUPPS oracles; the single most important check is a 200 status carrying an error body.
6. Write qa/sign-off-report.txt with a PASS / CONDITIONAL PASS / FAIL verdict and the bug summary.
7. bus_write DONE, then reply in ONE plain-text paragraph summarising cases written, endpoints tested, bugs found, and the verdict. The plain-text reply ends your run.`;

function singleTask(ctx: RunContext): string {
  return [
    `project: ${ctx.project} | sprint: ${ctx.sprint} | site: ${ctx.site}`,
    ctx.apiSpecPath ? `API spec: qa/${ctx.apiSpecPath}` : `API spec: qa/openapi.yaml (if present)`,
    `In-scope modules: ${ctx.modules.join(', ')}`,
    ctx.creds?.adminEmail ? `Admin credentials: ${ctx.creds.adminEmail} / ${ctx.creds.adminPassword}` : '',
    ``,
    `SOURCE DOCUMENT:`,
    ctx.docText,
  ].filter(Boolean).join('\n');
}

export interface SingleOptions {
  db?: DB;
  bus?: Bus;
  session?: string;
  externalSpecPath?: string;
  maxIterations?: number;   // default 60 — the solo needs headroom the 4 workers get collectively
  log?: (msg: string) => void;
}

export async function runSingle(ctx: RunContext, opts: SingleOptions = {}): Promise<Metrics> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const qaRoot = resolve(dirname(config.busPath));
  if (!existsSync(qaRoot)) mkdirSync(qaRoot, { recursive: true });
  if (ctx.site) process.env.SITE_URL = ctx.site;   // specs run by playwright_run read this

  const session = opts.session ?? `single-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const bus = opts.bus ?? new Bus(config.busPath, session);
  const db = opts.db ?? new DB(config.dbPath);

  if (opts.externalSpecPath && existsSync(opts.externalSpecPath)) {
    writeFileSync(join(qaRoot, 'openapi.yaml'), readFileSync(opts.externalSpecPath, 'utf8'));
    ctx.apiSpecPath = 'openapi.yaml';
  }

  const started = Date.now();
  const runId = db.startRun('single', `${ctx.project} sprint ${ctx.sprint}`);
  bus.write('META', metaPayload(ctx), 'single-agent');
  log(`[run #${runId}] single-agent baseline — ${ctx.project} sprint ${ctx.sprint}`);

  const agent = new AgentLoop({
    name: 'single-agent',
    model: 'worker',
    systemPrompt: SINGLE_AGENT_PROMPT,
    tools: allTools({ db, bus, qaRoot }),
    bus,
    maxIterations: opts.maxIterations ?? 60,
  });
  const outcome = await agent.run(singleTask(ctx));

  const t = { pass: 0, fail: 0, blocked: 0, skip: 0 };
  for (const r of db.results() as { status: string }[]) {
    if (r.status === 'PASS') t.pass++;
    else if (r.status === 'FAIL') t.fail++;
    else if (r.status === 'BLOCKED') t.blocked++;
    else if (r.status === 'SKIP') t.skip++;
  }

  const bugsCount = db.listBugs().length;
  const verdict = bugsCount === 0 ? 'PASS (no bugs found — verify coverage)' :
    db.listBugs().some((b) => b.severity === 'Critical') ? 'FAIL' : 'CONDITIONAL PASS';
  db.finishRun(runId, verdict);

  const metrics: Metrics = {
    mode: 'single',
    modeId: detectMode({ site: ctx.site, docText: ctx.docText, spec: Boolean(ctx.apiSpecPath) }).modeId,
    wallClockMs: Date.now() - started,
    totalTokens: outcome.tokens,
    bugs: bugsCount,
    disputes: db.listDisputes().length,   // structurally always 0 for the solo
    testCases: db.listCases().length,
    results: t,
    verdict,
  };
  writeMetrics(qaRoot, metrics);
  log(`[done] single-agent — status ${outcome.status}, ${metrics.bugs} bugs, ${metrics.testCases} cases, ${metrics.totalTokens} tokens, ${Math.round(metrics.wallClockMs / 1000)}s`);
  return metrics;
}
