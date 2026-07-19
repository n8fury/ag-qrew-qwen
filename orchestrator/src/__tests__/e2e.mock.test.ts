import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bus, parsePhase } from '../bus.js';
import { DB } from '../db.js';
import { runSociety } from '../agents/qaLead.js';
import type { RunContext } from '../agents/worker.js';

/**
 * Per-mode pipeline E2Es on the scripted mock model (AGQREW_MOCK=1, set in
 * setup.ts). One source of truth — detectMode — decides which phases run; these
 * tests prove the orchestrator honours it:
 *   full    (site + doc + spec) → all 9 phases, dispute → adjudication → verdict
 *   design  (doc only)          → 4 design phases, ZERO execution agents run
 *   explore (URL only)          → 8 phases, API battery skipped, still adjudicates
 * All offline: no API key, no demo-app, no browser (the DOM probe fails fast on the
 * closed port and the pipeline is designed to continue without it).
 */

// The mock never reasons over the spec, but the api-tester's bug_file spec-guard
// (undocumentedEndpointCited) DOES parse qa/openapi.yaml and refuses to file a bug
// citing an undocumented (method, path). So the spec must document POST /api/tasks
// in the 2-/4-space BLOCK form parseSpecPaths understands — flow style (post: {…})
// parses as a path with zero methods and would (correctly) reject the contract bug.
const MINIMAL_SPEC = `openapi: 3.0.0
info:
  title: Demo Task Manager
  version: 1.0.0
paths:
  /api/auth/login:
    post:
      responses:
        '200':
          description: ok
  /api/tasks:
    get:
      responses:
        '200':
          description: ok
    post:
      responses:
        '400':
          description: bad
  /api/tasks/{id}:
    delete:
      responses:
        '200':
          description: ok
`;
const DOC = 'Sprint 1 — login + task CRUD; title required, max 200 chars; missing/over-length → 400.';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'agqrew-e2e-'));
  return { dir, db: new DB(join(dir, 'agqrew.db')), bus: new Bus(join(dir, 'shared-task-list.txt'), 'e2e-session') };
}

const phaseTrail = (bus: Bus) =>
  bus.readAll().filter((s) => s.type === 'PHASE').map((s) => parsePhase(s.payload)!);
const doneAgents = (bus: Bus) =>
  new Set(bus.readAll().filter((s) => s.type === 'DONE').map((s) => s.from));

describe('society pipeline per mode (mock model)', () => {
  it('full (site + doc + spec) runs all 9 phases and preserves dispute/adjudication', async () => {
    const { dir, db, bus } = workspace();
    const specPath = join(dir, 'source-spec.yaml');
    writeFileSync(specPath, MINIMAL_SPEC);
    const ctx: RunContext = {
      project: 'Demo Task Manager', sprint: 1, site: 'http://127.0.0.1:9', // closed port — DOM probe fails fast
      modules: ['auth', 'tasks'],
      creds: { adminEmail: 'admin@demo.test', adminPassword: 'admin123' },
      docText: DOC,
    };

    const res = await runSociety(ctx, { db, bus, qaRoot: dir, externalSpecPath: specPath, autoApprove: true, enforceEnvGate: true });

    // Mode + store invariants
    expect(res.metrics.modeId).toBe('full');
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
    for (const f of ['metrics.json', 'test-plan-sprint1.txt', 'sign-off-report.txt']) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }

    // Every agent that ran signalled DONE on the bus
    const done = doneAgents(bus);
    for (const agent of ['qa-lead', 'qa-tc-writer', 'qa-api-tester', 'qa-script-writer', 'qa-hawk']) {
      expect(done, `missing DONE from ${agent}`).toContain(agent);
    }

    // PHASE signals: one per pipeline segment, strictly increasing, ending 9/9
    const trail = phaseTrail(bus);
    expect(trail.every((p) => p !== null)).toBe(true);
    expect(trail.map((p) => p.id)).toEqual(['env', 'plan', 'approval', 'cases', 'scripts', 'explore', 'api', 'adjudicate', 'signoff']);
    expect(trail.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(trail.at(-1)).toMatchObject({ index: 9, total: 9, id: 'signoff' });
  }, 120_000);

  it('design (doc only) runs the 4 design phases and skips every execution agent', async () => {
    const { dir, db, bus } = workspace();
    const ctx: RunContext = {
      project: 'Doc Only Co', sprint: 1, modules: ['auth', 'tasks'],
      docText: DOC,
    };

    const res = await runSociety(ctx, { db, bus, qaRoot: dir, autoApprove: true, enforceEnvGate: true });

    expect(res.metrics.modeId).toBe('design');
    expect(res.verdict).toBe('DESIGN COMPLETE');
    expect(res.bugs).toHaveLength(0);
    expect(res.disputes).toHaveLength(0);
    // the tc-writer still writes cases from the doc alone (design mode's whole point)
    expect(res.metrics.testCases).toBe(2);

    // ONLY the design agents ran — no env gate, no scripts/explore/api
    const done = doneAgents(bus);
    expect(done).toContain('qa-lead');
    expect(done).toContain('qa-tc-writer');
    for (const agent of ['qa-hawk', 'qa-script-writer', 'qa-api-tester']) {
      expect(done, `${agent} must NOT run in design mode`).not.toContain(agent);
    }

    // Only the 4 design PHASE signals, numbered 1..4 of 4
    const trail = phaseTrail(bus);
    expect(trail.map((p) => p.id)).toEqual(['plan', 'approval', 'cases', 'signoff']);
    expect(trail.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    expect(trail.at(-1)).toMatchObject({ index: 4, total: 4, id: 'signoff' });
    for (const skipped of ['env', 'scripts', 'explore', 'api', 'adjudicate']) {
      expect(trail.some((p) => p.id === skipped), `${skipped} must emit no PHASE signal`).toBe(false);
    }
    // design bypasses the env gate entirely — no HAWK-ENV on the bus
    expect(bus.readAll().some((s) => s.type === 'HAWK-ENV')).toBe(false);

    expect(existsSync(join(dir, 'test-plan-sprint1.txt'))).toBe(true);
    expect(existsSync(join(dir, 'sign-off-report.txt'))).toBe(true);
  }, 120_000);

  it('explore (URL only) runs 8 phases, skips the API battery, still adjudicates', async () => {
    const { dir, db, bus } = workspace();
    const ctx: RunContext = {
      project: 'URL Only Co', sprint: 1, site: 'http://127.0.0.1:9',
      modules: ['auth', 'tasks'],
      creds: { adminEmail: 'admin@demo.test', adminPassword: 'admin123' },
    };

    const res = await runSociety(ctx, { db, bus, qaRoot: dir, autoApprove: true, enforceEnvGate: true });

    expect(res.metrics.modeId).toBe('explore');
    // hawk files 2 UI bugs; with no api-tester there is no dispute, so the High
    // "deleted task" bug is never reclassified → CONDITIONAL PASS on 1 High.
    expect(res.disputes).toHaveLength(0);
    expect(res.bugs).toHaveLength(2);
    expect(res.verdict).toBe('CONDITIONAL PASS');

    const done = doneAgents(bus);
    for (const agent of ['qa-lead', 'qa-tc-writer', 'qa-script-writer', 'qa-hawk']) {
      expect(done, `missing DONE from ${agent}`).toContain(agent);
    }
    expect(done, 'qa-api-tester must NOT run without a spec').not.toContain('qa-api-tester');

    const trail = phaseTrail(bus);
    expect(trail.map((p) => p.id)).toEqual(['env', 'plan', 'approval', 'cases', 'scripts', 'explore', 'adjudicate', 'signoff']);
    expect(trail.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(trail.at(-1)).toMatchObject({ index: 8, total: 8, id: 'signoff' });
    expect(trail.some((p) => p.id === 'api'), 'api phase must be skipped without a spec').toBe(false);

    expect(existsSync(join(dir, 'metrics.json'))).toBe(true);
  }, 120_000);
});
