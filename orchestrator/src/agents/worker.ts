import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentLoop, type AgentOutcome } from '../agentLoop.js';
import type { QwenModel } from '../config.js';
import { toolsFor, type AgentName, type ToolDeps } from '../tools/index.js';
import type { Bus } from '../bus.js';

/**
 * Worker factory (plan tasks 4 & 6). Every worker — qa-tc-writer, qa-api-tester,
 * qa-script-writer, qa-hawk — and the qa-lead is the SAME `AgentLoop` engine,
 * differing only in (system prompt, model, tool registry). Rather than four
 * near-identical files, we load each agent's ported prompt from `prompts/*.md`
 * and build its `AgentLoop` here. The dependency ORDER in which the orchestrator
 * runs them (qaLead.ts) is what encodes the pipeline, not per-agent classes.
 */

const PROMPTS_DIR = new URL('../../prompts/', import.meta.url);

/** qa-lead reasons on the strong model; the four workers run on the worker tier.
 *  (qa-hawk's vision calls happen INSIDE the browser_snapshot tool on the vision model.) */
const MODEL_FOR: Record<AgentName, QwenModel> = {
  'qa-lead': 'lead',
  'qa-tc-writer': 'worker',
  'qa-api-tester': 'worker',
  'qa-script-writer': 'worker',
  'qa-hawk': 'worker',
};

/** Read a ported prompt and strip its YAML frontmatter — the body is the system prompt. */
export function loadPrompt(agent: AgentName): string {
  const path = fileURLToPath(new URL(`${agent}.md`, PROMPTS_DIR));
  const raw = readFileSync(path, 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

export interface WorkerBudget {
  maxIterations?: number;
  maxTokens?: number;
}

/** Build (but do not run) an agent's loop. */
export function makeAgent(agent: AgentName, deps: ToolDeps, budget: WorkerBudget = {}): AgentLoop {
  return new AgentLoop({
    name: agent,
    model: MODEL_FOR[agent],
    systemPrompt: loadPrompt(agent),
    tools: toolsFor(agent, deps),
    bus: deps.bus,
    maxIterations: budget.maxIterations,
    maxTokens: budget.maxTokens,
  });
}

/** Convenience: build and run in one call. */
export function runAgent(
  agent: AgentName,
  deps: ToolDeps,
  task: string,
  budget: WorkerBudget = {},
): Promise<AgentOutcome> {
  return makeAgent(agent, deps, budget).run(task);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task-string builders — the `user` message each agent receives. Everything an
// agent needs (site, spec path, module list, credentials) is embedded here AND
// mirrored onto the bus as a META line, so an agent that only reads the bus and
// one that only reads its task both get the full picture.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunContext {
  project: string;
  sprint: number;
  site: string;
  apiSpecPath?: string;   // path under qa/, e.g. "openapi.yaml"
  modules: string[];
  creds?: { adminEmail?: string; adminPassword?: string; userEmail?: string; userPassword?: string };
  docText: string;        // the source requirements / release note for the test plan
  siteMap?: string;       // documented UI entry points, so reachability is judged against real routes
}

function credLines(ctx: RunContext): string {
  const c = ctx.creds ?? {};
  return [
    c.adminEmail ? `  admin: ${c.adminEmail} / ${c.adminPassword ?? '(no password given)'}` : '',
    c.userEmail ? `  standard user: ${c.userEmail} / ${c.userPassword ?? '(no password given)'}` : '',
  ].filter(Boolean).join('\n') || '  (no credentials supplied — test the unauthenticated surface)';
}

export function metaPayload(ctx: RunContext): string {
  return `project_name=${ctx.project} | sprint=${ctx.sprint} | site=${ctx.site}` +
    (ctx.apiSpecPath ? ` | api_spec=qa/${ctx.apiSpecPath}` : '');
}

export function testPlanTask(ctx: RunContext): string {
  return [
    `Write the test plan for the following. Mode 1.`,
    `project: ${ctx.project} | sprint: ${ctx.sprint} | site URL: ${ctx.site}`,
    ctx.apiSpecPath ? `API spec: qa/${ctx.apiSpecPath}` : `API spec: none provided`,
    `In-scope modules: ${ctx.modules.join(', ')}`,
    ``,
    `SOURCE DOCUMENT:`,
    ctx.docText,
  ].join('\n');
}

function siteMapLines(ctx: RunContext): string[] {
  return ctx.siteMap ? [`Documented UI routes (judge reachability against THESE paths, not guessed ones):`, `  ${ctx.siteMap}`] : [];
}

export function hawkEnvTask(ctx: RunContext): string {
  return [
    // NB: no test-plan reference — the plan is written in Phase 1, AFTER this gate runs.
    `HAWK-TASK | mode: environment | site: ${ctx.site}`,
    `The test plan does not exist yet (you run before it is written) — validate the environment from this task alone.`,
    `In-scope modules to reach: ${ctx.modules.join(', ')}`,
    ...siteMapLines(ctx),
    `Credentials:`,
    credLines(ctx),
  ].join('\n');
}

export function tcWriterTask(ctx: RunContext): string {
  return [
    `Write test cases for these modules (in order): ${ctx.modules.join(', ')}`,
    `project: ${ctx.project} | sprint: ${ctx.sprint} | site: ${ctx.site}`,
    `Read the SFDIPOT coverage map and expected results from qa/test-plan-sprint${ctx.sprint}.txt (fs_read it).`,
    `DELIVERABLE CONTRACT (non-negotiable): for EACH module you MUST call tc_store exactly once`,
    `with 6-8 focused cases (happy path, key negatives, one boundary each) BEFORE you finish.`,
    `tc_store emits TC-READY — the script-writer and hawk consume these cases; finishing with`,
    `zero tc_store calls breaks the whole pipeline and is a protocol violation.`,
  ].join('\n');
}

export function apiTesterTask(ctx: RunContext): string {
  return [
    `API-TASK | agent: qa-api-tester | base URL: ${ctx.site}` +
      (ctx.apiSpecPath ? ` | spec: qa/${ctx.apiSpecPath}` : ` | spec: qa/openapi.yaml`),
    `project: ${ctx.project} | sprint: ${ctx.sprint}`,
    `Credentials for authed endpoints:`,
    credLines(ctx),
    `Test ONLY the (method, path) pairs documented in the spec — a 404 from an undocumented`,
    `path is correct behaviour, never a bug. Every bug's oracle must QUOTE the spec line violated.`,
    `PRIORITY CHECKS straight from the release notes ("Creating a task with a missing or`,
    `over-length title must be rejected with a 400 error") — run these FIRST, before anything else:`,
    `(1) POST /api/tasks with NO title (authed) — expect 400; READ THE BODY of whatever comes back;`,
    `(2) POST /api/tasks with a 201-character title (authed) — expect 400 per the spec's maxLength: 200;`,
    `(3) POST /api/tasks with no Authorization header — expect 401.`,
    `File a bug immediately for each mismatch, then continue the full battery.`,
    `MANDATORY FINAL STEP before your DONE signal: bus_read all BUG-FILED signals; for each`,
    `UI bug about data (count, list, persistence, delete/create "not working"), reproduce the`,
    `equivalent API check; raise_dispute with your evidence wherever the API layer behaves`,
    `correctly per spec and the bug as filed blames the wrong layer.`,
  ].join('\n');
}

/**
 * Focused dispute cross-check (Track-3 reliability). Run ONLY when the api-tester's
 * main pass ended with zero disputes but other agents filed data/UI bugs. A short,
 * clean context — just the other agents' bugs — so the mandatory Step-6 cross-check
 * is not lost at the tail of a long endpoint battery. The agent still decides
 * genuinely: it raises a dispute only where its API evidence truly contradicts a
 * bug as filed, and otherwise just finishes. This does NOT manufacture disputes.
 */
export function apiTesterDisputeTask(ctx: RunContext, bugsBlock: string): string {
  return [
    `API-TASK | agent: qa-api-tester | mode: dispute cross-check | base URL: ${ctx.site}` +
      (ctx.apiSpecPath ? ` | spec: qa/${ctx.apiSpecPath}` : ` | spec: qa/openapi.yaml`),
    `Your endpoint battery is done. This is the MANDATORY final cross-check (Step 6), isolated`,
    `so nothing is missed. Other agents have filed these bugs:`,
    ``,
    bugsBlock,
    ``,
    `For EACH bug above that concerns data behaviour (a count, a list, persistence, a`,
    `delete/create "not working"), reproduce the equivalent API check with http_request`,
    `(e.g. for a "deleted task still shows" bug: POST a task, DELETE it, then GET the list).`,
    `Then decide, per bug:`,
    `  - If the API layer behaves CORRECTLY per spec while the bug as filed blames the API/data`,
    `    layer (the defect is really elsewhere, e.g. UI refresh), call raise_dispute with your`,
    `    concrete evidence (method + URL + status + body slice).`,
    `  - If your evidence CONFIRMS the bug, do nothing — do not re-file it.`,
    `Only dispute the SAME behaviour with concrete evidence — never a hunch. If nothing`,
    `genuinely contradicts, reply in plain text that the cross-check found no contradictions.`,
    `Credentials for authed endpoints:`,
    credLines(ctx),
  ].join('\n');
}

export function scriptWriterTask(ctx: RunContext, domInventory = ''): string {
  const lines = ctx.modules
    .map((m) => `  - ${m}  → read stored cases via tc_list module=${m} → write qa/automation/specs/${m}.spec.ts`)
    .join('\n');
  // The orchestrator probed the REAL DOM and passes it here (in the task message, which is
  // never compacted) so selectors are grounded in ground truth, not hallucinated.
  const domBlock = domInventory
    ? [
        ``,
        `GROUND-TRUTH DOM — probed LIVE from the real site by the orchestrator. These are the`,
        `ACTUAL elements on each route. Derive EVERY selector from THIS inventory — do NOT invent`,
        `labels, ids, or data-testids, and do NOT write your own probe (this replaces it):`,
        domInventory,
        `SELECTOR RULES (from the inventory above):`,
        `- Prefer #id, then getByLabel("<exact label text above>"), then getByPlaceholder, then getByText.`,
        `- A password input has NO textbox role — locate it by #id or its label, never getByRole('textbox').`,
        `- Match button/label/heading text EXACTLY as shown above (case included).`,
        `- For authed pages (e.g. /tasks) LOG IN via the auth flow FIRST, then assert page content.`,
      ].join('\n')
    : '';
  return [
    `E2E-TASK | agent: qa-script-writer | site: ${ctx.site} | modules (in order):`,
    lines,
    `project: ${ctx.project} | sprint: ${ctx.sprint}`,
    ...siteMapLines(ctx),
    `CREDENTIALS — use these EXACT values in every login step. NEVER invent an email or password`,
    `(no "user@test.com", no "SecurePass123!"). These are the ONLY accounts that exist; any other`,
    `login returns HTTP 401 with a generic error:`,
    credLines(ctx),
    `A SUCCESSFUL login lands on /tasks. To assert a redirect, use waitForURL('**/tasks') OR check`,
    `page.url().includes('/tasks') — NEVER waitForURL('/tasks'): a bare path does not match the full`,
    `URL (e.g. http://host:3000/tasks) and will time out even though the navigation succeeded.`,
    `This app has NO forgot-password flow, NO field-level validation messages, and NO`,
    `password-strength rules — if a stored test case asserts such a feature or any specific error`,
    `text, that feature does NOT exist here: record the case BLOCKED with a short note ("feature`,
    `not present in app") instead of asserting invented UI text. Do not fabricate selectors or`,
    `messages for features you cannot see in the GROUND-TRUTH DOM below.`,
    domBlock,
    `DELIVERABLE CONTRACT (non-negotiable): result_record calls are your PRIMARY deliverable —`,
    `finishing with zero result_record calls fails the whole run, a protocol violation.`,
    `Per module, in this exact order: ONE flat spec via the shared runner (selectors from the`,
    `GROUND-TRUTH DOM above, expected text inline — SKIP the locators/pages/data tier files) →`,
    `playwright_run → IMMEDIATELY result_record EVERY case in that spec exactly as observed`,
    `(PASS/FAIL/BLOCKED), BEFORE any repair. Only then: at most 2 repair cycles, re-record only`,
    `outcomes that changed, SECTION-DONE, next module. An honest recorded FAIL beats an unrecorded`,
    `clean run — but a FAIL caused by a selector you invented instead of using the DOM above is your`,
    `own bug: fix it against the inventory, never file it as a product defect.`,
  ].join('\n');
}

export function hawkExploreTask(ctx: RunContext): string {
  return [
    `HAWK-TASK | mode: explore | modules: ${ctx.modules.join(', ')} | site: ${ctx.site}`,
    `project: ${ctx.project} | sprint: ${ctx.sprint}`,
    ...siteMapLines(ctx),
    `Smoke each module first; on smoke pass, run risk-based exploratory testing (SFDIPOT + FEW HICCUPPS).`,
    `Read stored cases with tc_list; read the SFDIPOT map from qa/test-plan-sprint${ctx.sprint}.txt.`,
    `PRIORITY ORACLES straight from the requirements doc — check these FIRST and file bugs immediately:`,
    `(1) browser_snapshot the tasks page and read its H2 heading VERBATIM from the vision transcript —`,
    `    the requirements demand an accurate task count in the header (e.g. "Tasks (3)"). If the heading`,
    `    shows anything that is not the true number — the wrong number, or a non-value like "undefined" —`,
    `    that is a bug: file it immediately, quoting the heading text exactly;`,
    `(2) DELETE staleness — run this exact sequence, do not skip the DELETE leg:`,
    `    a. POST /api/tasks to create a task (note its id), b. DELETE /api/tasks/{id} via the API,`,
    `    c. GET /api/tasks AND browser_snapshot /tasks — the requirements say the tasks page`,
    `    "must always show the current list of tasks"; if the page still shows the deleted task`,
    `    while the API list omits it, that is a bug (file it with both pieces of evidence).`,
    `    (Create-then-recheck alone is NOT enough — the delete leg is where refresh defects hide.)`,
    `Budget: browser_snapshot is expensive — use it at most 4 times; bug_file the moment evidence`,
    `is in hand; raise_dispute when your UI evidence contradicts recorded API behaviour (or vice versa).`,
    `DELIVERABLE CONTRACT (non-negotiable) — your SECTION-DONE for the tasks module is INVALID unless`,
    `BOTH happened: (a) the full DELETE staleness sequence above was executed and its outcome is on`,
    `record — either a filed bug (page still shows the deleted task) or an explicit "delete refresh`,
    `clean" line in your report; filing the count-header bug does NOT satisfy this — they are two`,
    `separate priority oracles; (b) you called result_record for every stored case (tc_list row ids)`,
    `you could evaluate with your tools — a module with zero recorded results is a protocol violation.`,
    `Credentials:`,
    credLines(ctx),
  ].join('\n');
}

export function signOffTask(ctx: RunContext, summary: string): string {
  return [
    `Write the sign-off report. Mode 2.`,
    `project: ${ctx.project} | sprint: ${ctx.sprint}`,
    ``,
    `Consolidated evidence from the run (bugs after adjudication, dispute verdicts, result tallies):`,
    summary,
  ].join('\n');
}
