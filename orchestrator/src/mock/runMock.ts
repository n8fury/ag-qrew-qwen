import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DB } from '../db.js';
import { Bus } from '../bus.js';
import { runSociety } from '../agents/qaLead.js';
import type { RunContext } from '../agents/worker.js';

/**
 * Offline proof of the society (run with AGQREW_MOCK=1 via `npm run demo:mock`).
 * Drives the full pipeline against the mock model on a throwaway DB/bus and
 * asserts the end-to-end invariants: cases stored, bugs filed, ONE dispute raised,
 * a rebuttal recorded, the judge RECLASSIFIES it, and the verdict is CONDITIONAL
 * PASS. This verifies the wiring with no API key.
 */

const dir = mkdtempSync(join(tmpdir(), 'agqrew-mock-'));
const db = new DB(join(dir, 'agqrew.db'));
const bus = new Bus(join(dir, 'shared-task-list.txt'), 'mock-session');

const ctx: RunContext = {
  project: 'Demo Task Manager', sprint: 1, site: 'http://localhost:3000',
  modules: ['auth', 'tasks'],
  creds: { adminEmail: 'admin@demo.test', adminPassword: 'admin123' },
  docText: 'Sprint 1 — login + task CRUD; title required, max 200 chars; missing/over-length → 400.',
};

// A spec makes this a genuine `full` run (site + doc + spec) so the api-tester
// participates and the dispute → adjudication path exercises end-to-end. The mock
// never reasons over the spec, but the api-tester's bug_file spec-guard parses
// qa/openapi.yaml — so document POST /api/tasks in the BLOCK form parseSpecPaths
// reads (flow style would parse as a path with zero methods and reject the bug).
const specPath = join(dir, 'source-spec.yaml');
writeFileSync(specPath, [
  'openapi: 3.0.0',
  'info:',
  '  title: Demo Task Manager',
  '  version: 1.0.0',
  'paths:',
  '  /api/auth/login:',
  '    post:',
  '      responses:',
  "        '200':",
  '          description: ok',
  '  /api/tasks:',
  '    get:',
  '      responses:',
  "        '200':",
  '          description: ok',
  '    post:',
  '      responses:',
  "        '400':",
  '          description: bad',
  '  /api/tasks/{id}:',
  '    delete:',
  '      responses:',
  "        '200':",
  '          description: ok',
  '',
].join('\n'));

// qaRoot: keep ALL artifacts (sign-off report, metrics.json) in the temp
// workspace — without it the mock clobbers a real run's files in ./qa.
const res = await runSociety(ctx, { db, bus, qaRoot: dir, externalSpecPath: specPath, autoApprove: true, enforceEnvGate: true });

const rebuttalSeen = bus.readAll().some((s) => s.type === 'PROGRESS' && s.payload.startsWith('rebuttal by'));
const d0 = res.disputes[0];

const checks: [string, boolean][] = [
  ['test cases stored (2)', res.metrics.testCases === 2],
  ['bugs filed (>=3)', res.bugs.length >= 3],
  ['exactly one dispute raised', res.disputes.length === 1],
  ['a rebuttal was recorded on the bus', rebuttalSeen],
  ['judge RECLASSIFIED the dispute', d0?.verdict === 'RECLASSIFIED'],
  ['disputed bug severity downgraded to Medium', res.bugs.find((b) => b.id === d0?.bug_id)?.severity === 'Medium'],
  ['no dispute left OPEN', db.openDisputes().length === 0],
  ['verdict is CONDITIONAL PASS', res.verdict === 'CONDITIONAL PASS'],
];

console.log('\n──── MOCK SOCIETY SELF-CHECK ────');
let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? '✅' : '❌'}  ${label}`);
  if (!pass) ok = false;
}
console.log(`\nmetrics: ${JSON.stringify(res.metrics)}`);
console.log(`temp workspace: ${dir}`);
console.log(ok ? '\n✅ MOCK PASS — the full society path runs end-to-end (no API key needed).' : '\n❌ MOCK FAIL — see the unchecked invariants above.');
process.exit(ok ? 0 : 1);
