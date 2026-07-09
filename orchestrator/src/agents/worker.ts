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
    `HAWK-TASK | mode: environment | site: ${ctx.site} | test-plan: test-plan-sprint${ctx.sprint}.txt`,
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
    `Store each module's cases with tc_store (this emits TC-READY), then continue to the next module.`,
  ].join('\n');
}

export function apiTesterTask(ctx: RunContext): string {
  return [
    `API-TASK | agent: qa-api-tester | base URL: ${ctx.site}` +
      (ctx.apiSpecPath ? ` | spec: qa/${ctx.apiSpecPath}` : ` | spec: qa/openapi.yaml`),
    `project: ${ctx.project} | sprint: ${ctx.sprint}`,
    `Credentials for authed endpoints:`,
    credLines(ctx),
  ].join('\n');
}

export function scriptWriterTask(ctx: RunContext): string {
  const lines = ctx.modules
    .map((m) => `  - ${m}  → read stored cases via tc_list module=${m} → write qa/automation/specs/${m}.spec.ts`)
    .join('\n');
  return [
    `E2E-TASK | agent: qa-script-writer | site: ${ctx.site} | modules (in order):`,
    lines,
    `project: ${ctx.project} | sprint: ${ctx.sprint}`,
    ...siteMapLines(ctx),
    `Credentials:`,
    credLines(ctx),
  ].join('\n');
}

export function hawkExploreTask(ctx: RunContext): string {
  return [
    `HAWK-TASK | mode: explore | modules: ${ctx.modules.join(', ')} | site: ${ctx.site}`,
    `project: ${ctx.project} | sprint: ${ctx.sprint}`,
    ...siteMapLines(ctx),
    `Smoke each module first; on smoke pass, run risk-based exploratory testing (SFDIPOT + FEW HICCUPPS).`,
    `Read stored cases with tc_list; read the SFDIPOT map from qa/test-plan-sprint${ctx.sprint}.txt.`,
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
