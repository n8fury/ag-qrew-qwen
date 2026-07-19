import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB, type Bug } from '../db.js';

const fresh = () => new DB(join(mkdtempSync(join(tmpdir(), 'agqrew-db-')), 't.db'));

const bug: Bug = {
  title: 'a bug', severity: 'High', module: 'tasks', oracle: 'Claims',
  steps: '1. do', expected: 'ok', actual: 'not ok', found_by: 'qa-hawk',
};

describe('DB foreign keys', () => {
  it('rejects a result for a non-existent test case', () => {
    const db = fresh();
    expect(() => db.recordResult({ case_id: 9999, status: 'PASS' })).toThrow(/FOREIGN KEY/);
  });

  it('rejects a dispute against a non-existent bug', () => {
    const db = fresh();
    expect(() => db.raiseDispute({
      bug_id: 9999, raised_by: 'qa-hawk', challenged_by: 'qa-api-tester', claim: 'c', counter_claim: 'cc',
    })).toThrow(/FOREIGN KEY/);
  });

  it('accepts rows whose foreign keys exist', () => {
    const db = fresh();
    const [caseId] = db.storeCases([{
      module: 'auth', tc_ref: 'TC-001', title: 'Verify that login works', section: 'UI',
      type: 'Functional', priority: 'High', preconditions: '-', steps: '1.', test_data: 'N/A', expected: '-',
    }]);
    const bugId = db.fileBug(bug);
    expect(() => db.recordResult({ case_id: caseId, status: 'PASS' })).not.toThrow();
    expect(() => db.raiseDispute({
      bug_id: bugId, raised_by: 'qa-hawk', challenged_by: 'qa-api-tester', claim: 'c', counter_claim: 'cc',
    })).not.toThrow();
  });

  it('reset still clears every table in FK-safe order', () => {
    const db = fresh();
    const [caseId] = db.storeCases([{
      module: 'auth', tc_ref: 'TC-001', title: 'Verify that login works', section: 'UI',
      type: 'Functional', priority: 'High', preconditions: '-', steps: '1.', test_data: 'N/A', expected: '-',
    }]);
    db.recordResult({ case_id: caseId, status: 'PASS' });
    const bugId = db.fileBug(bug);
    db.raiseDispute({ bug_id: bugId, raised_by: 'a', challenged_by: 'b', claim: 'c', counter_claim: 'cc' });
    expect(() => db.reset()).not.toThrow();
    expect(db.listCases()).toHaveLength(0);
    expect(db.listBugs()).toHaveLength(0);
    expect(db.listDisputes()).toHaveLength(0);
    expect(db.results()).toHaveLength(0);
  });
});
