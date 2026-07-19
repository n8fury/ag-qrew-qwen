import { describe, expect, it } from 'vitest';
import { buildJudgePrompt, buildRebuttalPrompt, parseVerdict } from '../adjudicate.js';
import type { Bug, Dispute } from '../db.js';

const dispute: Dispute = {
  id: 1, bug_id: 7, raised_by: 'qa-hawk', challenged_by: 'qa-api-tester',
  claim: 'A deleted task still shows in the list, so deletion does not persist.',
  counter_claim: 'DELETE returns 200 and GET omits the item — the API state is correct.',
};

const bug: Bug = {
  id: 7, title: 'Deleted task still appears', severity: 'High', module: 'tasks',
  oracle: 'History — UI diverges from data after a delete',
  steps: '1. create a task\n2. DELETE /api/tasks/{id}\n3. reload /tasks',
  expected: 'the deleted task no longer appears',
  actual: 'the deleted task is still listed',
  found_by: 'qa-hawk',
  evidence: 'qa/screenshots/tasks-after-delete.png',
};

describe('buildRebuttalPrompt', () => {
  it('gives the filer its full bug row — steps and evidence included', () => {
    const p = buildRebuttalPrompt(dispute, bug);
    expect(p).toContain('You are qa-hawk');
    expect(p).toContain(bug.steps);
    expect(p).toContain('qa/screenshots/tasks-after-delete.png');
    expect(p).toContain(dispute.counter_claim);
  });

  it('degrades gracefully without a bug row', () => {
    const p = buildRebuttalPrompt(dispute, undefined);
    expect(p).toContain('(bug row not found)');
    expect(p).toContain(dispute.claim);
  });
});

describe('buildJudgePrompt', () => {
  it('shows the judge the reproduction steps, evidence, and all three positions', () => {
    const p = buildJudgePrompt(dispute, bug, 'Conceded — it is a UI-refresh defect.');
    expect(p).toContain(bug.steps);
    expect(p).toContain('evidence: qa/screenshots/tasks-after-delete.png');
    expect(p).toContain(`AGENT A — qa-hawk (filed the finding) claims:`);
    expect(p).toContain(`AGENT B — qa-api-tester (contradicting evidence) counters:`);
    expect(p).toContain('Conceded — it is a UI-refresh defect.');
  });

  it('marks a missing evidence field explicitly rather than omitting the line', () => {
    const p = buildJudgePrompt(dispute, { ...bug, evidence: undefined }, 'r');
    expect(p).toContain('evidence: (none recorded)');
  });

  it('degrades gracefully without a bug row', () => {
    expect(buildJudgePrompt(dispute, undefined, 'r')).toContain('(bug row not found)');
  });
});

describe('parseVerdict', () => {
  it('parses strict JSON', () => {
    const a = parseVerdict('{"verdict":"REJECTED","rationale":"counter-evidence is decisive"}');
    expect(a).toMatchObject({ verdict: 'REJECTED', rationale: 'counter-evidence is decisive' });
  });

  it('parses JSON wrapped in markdown fences', () => {
    const a = parseVerdict('```json\n{"verdict":"DOWNGRADED","rationale":"real but minor","newSeverity":"Low"}\n```');
    expect(a).toMatchObject({ verdict: 'DOWNGRADED', newSeverity: 'Low' });
  });

  it('parses JSON wrapped in prose', () => {
    const a = parseVerdict('After weighing both sides: {"verdict":"RECLASSIFIED","rationale":"UI bug, not data","newTitle":"UI does not refresh"} — final.');
    expect(a).toMatchObject({ verdict: 'RECLASSIFIED', newTitle: 'UI does not refresh' });
  });

  it('defaults to UPHELD with a fallback rationale on garbage', () => {
    const a = parseVerdict('I cannot decide.');
    expect(a.verdict).toBe('UPHELD');
    expect(a.rationale).toMatch(/defaulted to UPHELD/);
  });

  it('drops an invalid verdict/severity rather than trusting it', () => {
    const a = parseVerdict('{"verdict":"OVERRULED","rationale":"x","newSeverity":"Catastrophic"}');
    expect(a.verdict).toBe('UPHELD'); // unknown verdict → safe default
    expect(a.newSeverity).toBeUndefined();
  });
});
