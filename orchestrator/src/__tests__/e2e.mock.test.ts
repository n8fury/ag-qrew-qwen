import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bus, parsePhase } from '../bus.js';
import { DB } from '../db.js';
import { runSociety } from '../agents/qaLead.js';
import type { RunContext } from '../agents/worker.js';

/**
 * Full-pipeline E2E on the scripted mock model (AGQREW_MOCK=1, set in setup.ts):
 * society run → cases stored → bugs filed → dispute → rebuttal → adjudication →
 * verdict → metrics. Runs with no API key, no demo-app, no browser required
 * (the DOM probe fails fast and the pipeline is designed to continue without it).
 */
describe('society pipeline (mock model)', () => {
  it('runs end-to-end and preserves the dispute/adjudication invariants', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agqrew-e2e-'));
    const db = new DB(join(dir, 'agqrew.db'));
    const bus = new Bus(join(dir, 'shared-task-list.txt'), 'e2e-session');

    const ctx: RunContext = {
      project: 'Demo Task Manager', sprint: 1, site: 'http://127.0.0.1:9', // closed port — DOM probe fails fast
      modules: ['auth', 'tasks'],
      creds: { adminEmail: 'admin@demo.test', adminPassword: 'admin123' },
      docText: 'Sprint 1 — login + task CRUD; title required, max 200 chars; missing/over-length → 400.',
    };

    const res = await runSociety(ctx, { db, bus, qaRoot: dir, autoApprove: true, enforceEnvGate: true });

    // Store invariants
    expect(res.metrics.testCases).toBe(2);
    expect(res.bugs.length).toBeGreaterThanOrEqual(3);

    // Track-3 conflict resolution: one dispute, rebutted, adjudicated, none left open
    expect(res.disputes).toHaveLength(1);
    const d0 = res.disputes[0];
    expect(d0.verdict).toBe('RECLASSIFIED');
    expect(db.openDisputes()).toHaveLength(0);
    expect(bus.readAll().some((s) => s.type === 'PROGRESS' && s.payload.startsWith('rebuttal by'))).toBe(true);
    expect(res.bugs.find((b) => b.id === d0.bug_id)?.severity).toBe('Medium');

    // Verdict + artefacts
    expect(res.verdict).toBe('CONDITIONAL PASS');
    expect(existsSync(join(dir, 'metrics.json'))).toBe(true);
    expect(existsSync(join(dir, 'test-plan-sprint1.txt'))).toBe(true);
    expect(existsSync(join(dir, 'sign-off-report.txt'))).toBe(true);

    // Every agent that ran signalled DONE on the bus
    const done = new Set(bus.readAll().filter((s) => s.type === 'DONE').map((s) => s.from));
    for (const agent of ['qa-lead', 'qa-tc-writer', 'qa-api-tester', 'qa-script-writer', 'qa-hawk']) {
      expect(done, `missing DONE from ${agent}`).toContain(agent);
    }

    // PHASE signals: one per pipeline segment, strictly increasing, ending 9/9
    const phases = bus.readAll().filter((s) => s.type === 'PHASE').map((s) => parsePhase(s.payload));
    expect(phases.every((p) => p !== null)).toBe(true);
    const indexes = phases.map((p) => p!.index);
    expect(indexes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(phases.at(-1)).toMatchObject({ index: 9, total: 9, id: 'signoff' });
  }, 120_000);
});
