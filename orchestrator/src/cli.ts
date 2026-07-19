import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { runSociety } from './agents/qaLead.js';
import { runSingle } from './baseline/singleAgent.js';
import { config } from './config.js';
import { demoContext } from './demoPreset.js';
import type { RunContext } from './agents/worker.js';

/**
 * CLI entry (plan task 8). Runs the pipeline in either mode:
 *   npm run run:society        # the 5-agent QA society (default)
 *   npm run run:single         # the monolithic baseline
 * Flags: --mode society|single, --site <url>, --spec <path>, --interactive (human
 * proceed gate), --no-gate (ignore a BLOCKED environment).
 * With no --doc/--site it targets the bundled demo-app.
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function demoRun(): { ctx: RunContext; specPath: string } {
  const specPath = fileURLToPath(new URL('../../demo-app/openapi.yaml', import.meta.url));
  return {
    ctx: demoContext(arg('site', config.demoAppUrl)!),
    specPath: arg('spec', specPath)!,
  };
}

async function main() {
  const mode = (arg('mode', 'society') as 'society' | 'single');
  const { ctx, specPath } = demoRun();
  const externalSpecPath = existsSync(specPath) ? specPath : undefined;
  if (!externalSpecPath) console.warn(`[warn] spec not found at ${specPath} — qa-api-tester will look for qa/openapi.yaml.`);

  console.log(`\n=== AG-QREW on Qwen — mode: ${mode} ===`);
  console.log(`target: ${ctx.site}  |  modules: ${ctx.modules.join(', ')}\n`);

  if (mode === 'single') {
    const m = await runSingle(ctx, { externalSpecPath });
    console.log(`\nBASELINE metrics:`, JSON.stringify(m, null, 2));
    return;
  }

  // society
  const interactive = flag('interactive');
  const onCheckpoint = interactive
    ? async (planFile: string) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ans = await rl.question(`\nTest plan written to qa/${planFile}. Type "proceed" to spawn the workers: `);
        rl.close();
        if (ans.trim().toLowerCase() !== 'proceed') { console.log('Aborted at checkpoint.'); process.exit(0); }
      }
    : undefined;

  const res = await runSociety(ctx, {
    externalSpecPath,
    enforceEnvGate: !flag('no-gate'),
    autoApprove: !interactive,
    onCheckpoint,
  });

  console.log(`\n=== VERDICT: ${res.verdict} ===`);
  console.log(`bugs: ${res.metrics.bugs} | disputes: ${res.metrics.disputes} | cases: ${res.metrics.testCases} | tokens: ${res.metrics.totalTokens} | ${Math.round(res.metrics.wallClockMs / 1000)}s`);
  if (res.blockers.length) console.log(`blockers: ${res.blockers.map((b) => b.payload).join('; ')}`);
  console.log(`per-agent tokens:`);
  for (const o of res.outcomes) {
    const over = o.tokens > 150_000 ? ` ⚠️  (over 150k target)` : '';
    console.log(`  ${o.name}: ${o.tokens} tokens, ${o.iterations} iterations, status ${o.status}${over}`);
  }
  for (const b of res.bugs) console.log(`  bug #${b.id} [${b.severity}] (${b.module}) ${b.title}`);
}

main().catch((err) => { console.error('CLI failed:', err); process.exit(1); });
