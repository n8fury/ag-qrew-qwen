import { mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DB } from './db.js';
import { Bus } from './bus.js';
import { runAgent, tcWriterTask, metaPayload, type RunContext } from './agents/worker.js';
import type { ToolDeps } from './tools/index.js';

/**
 * Single-agent live probe (companion to probeModels.ts): runs ONLY qa-tc-writer
 * against a throwaway qa/ workspace with a tight budget, so a prompt or loop
 * regression can be diagnosed for ~5% of the cost of a full society run.
 *
 *   npx tsx src/probeTcWriter.ts
 *
 * Needs qa/test-plan-sprint1.txt from a previous run (or the mock plan text).
 * Success = tc_store rows in the DB and a DONE within the iteration budget.
 */

const srcPlan = resolve('qa/test-plan-sprint1.txt');
if (!existsSync(srcPlan)) {
  console.error('No qa/test-plan-sprint1.txt found — run a society run (or copy a plan) first.');
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), 'agqrew-probe-'));
copyFileSync(srcPlan, join(root, 'test-plan-sprint1.txt'));

const ctx: RunContext = {
  project: 'Demo Task Manager', sprint: 1, site: 'http://localhost:3000',
  modules: ['auth', 'tasks'],
  docText: 'Sprint 1 — login + task CRUD; title required, max 200 chars; missing/over-length → 400.',
};

const db = new DB(join(root, 'probe.db'));
const bus = new Bus(join(root, 'shared-task-list.txt'), 'probe');
bus.write('META', metaPayload(ctx), 'probe');
const deps: ToolDeps = { db, bus, qaRoot: root };

console.log(`probe workspace: ${root}`);
const outcome = await runAgent('qa-tc-writer', deps, tcWriterTask(ctx), {
  maxIterations: 15, maxTokens: 120_000,
});

const cases = db.listCases();
console.log('\n──── PROBE RESULT ────');
console.log(`status: ${outcome.status} | iterations: ${outcome.iterations} | tokens: ${outcome.tokens}`);
console.log(`cases stored: ${cases.length}`);
for (const c of cases) console.log(`  #${c.id} [${c.module}] ${c.tc_ref} (${c.type}) ${c.title}`);
console.log(`\nbus:\n${bus.readAll().map((s) => '  ' + s.raw).join('\n')}`);
const ok = outcome.status === 'done' && cases.length >= 12 && outcome.tokens <= 120_000;
console.log(ok ? '\n✅ PROBE PASS — tc-writer stores cases within budget.' : '\n❌ PROBE FAIL — see trace above.');
process.exit(ok ? 0 : 1);
