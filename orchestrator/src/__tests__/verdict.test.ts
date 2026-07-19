import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bus } from '../bus.js';
import { DB, type Bug } from '../db.js';
import { computeVerdict } from '../agents/qaLead.js';

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'agqrew-verdict-'));
  return { db: new DB(join(dir, 't.db')), bus: new Bus(join(dir, 'bus.txt'), 'test') };
}

const bug = (severity: Bug['severity']): Bug => ({
  title: `${severity} bug`, severity, module: 'tasks', oracle: 'Claims',
  steps: '1. do', expected: 'ok', actual: 'not ok', found_by: 'qa-hawk',
});

describe('computeVerdict', () => {
  it('PASS on a clean run', () => {
    const { db, bus } = fresh();
    expect(computeVerdict(db, bus)).toBe('PASS');
  });

  it('PASS with only Medium/Low bugs', () => {
    const { db, bus } = fresh();
    db.fileBug(bug('Medium'));
    db.fileBug(bug('Low'));
    expect(computeVerdict(db, bus)).toBe('PASS');
  });

  it('CONDITIONAL PASS with 1-2 High bugs', () => {
    const { db, bus } = fresh();
    db.fileBug(bug('High'));
    expect(computeVerdict(db, bus)).toBe('CONDITIONAL PASS');
    db.fileBug(bug('High'));
    expect(computeVerdict(db, bus)).toBe('CONDITIONAL PASS');
  });

  it('FAIL with more than 2 High bugs', () => {
    const { db, bus } = fresh();
    db.fileBug(bug('High'));
    db.fileBug(bug('High'));
    db.fileBug(bug('High'));
    expect(computeVerdict(db, bus)).toBe('FAIL');
  });

  it('FAIL on any Critical bug', () => {
    const { db, bus } = fresh();
    db.fileBug(bug('Critical'));
    expect(computeVerdict(db, bus)).toBe('FAIL');
  });

  it('FAIL on an outstanding BLOCKED signal', () => {
    const { db, bus } = fresh();
    bus.write('BLOCKED', 'qa-hawk cannot reach the site', 'qa-hawk');
    expect(computeVerdict(db, bus)).toBe('FAIL');
  });

  it('FAIL on an unresolved dispute', () => {
    const { db, bus } = fresh();
    const bugId = db.fileBug(bug('Low'));
    db.raiseDispute({
      bug_id: bugId, raised_by: 'qa-hawk', challenged_by: 'qa-api-tester',
      claim: 'c', counter_claim: 'cc',
    });
    expect(computeVerdict(db, bus)).toBe('FAIL');
  });

  it('excludes REJECTED bugs: a rejected Critical no longer fails the run', () => {
    const { db, bus } = fresh();
    const bugId = db.fileBug(bug('Critical'));
    const disputeId = db.raiseDispute({
      bug_id: bugId, raised_by: 'qa-hawk', challenged_by: 'qa-api-tester',
      claim: 'c', counter_claim: 'cc',
    });
    db.resolveDispute(disputeId, 'REJECTED', 'counter-evidence disproves it');
    expect(computeVerdict(db, bus)).toBe('PASS');
  });

  it('a DOWNGRADED bug still counts at its new severity', () => {
    const { db, bus } = fresh();
    const bugId = db.fileBug(bug('Critical'));
    const disputeId = db.raiseDispute({
      bug_id: bugId, raised_by: 'qa-hawk', challenged_by: 'qa-api-tester',
      claim: 'c', counter_claim: 'cc',
    });
    db.resolveDispute(disputeId, 'DOWNGRADED', 'real but overstated');
    db.setBugSeverity(bugId, 'High');
    expect(computeVerdict(db, bus)).toBe('CONDITIONAL PASS');
  });
});
