import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * SQLite persistence — replaces TestRail/Jira with a self-contained store a judge
 * can inspect via the dashboard after one `docker compose up`. Four tables:
 * test_cases, runs, results, bugs. Schema is intentionally flat and demo-legible.
 */
export type CaseType = 'Functional' | 'Negative' | 'Boundary' | 'Edge' | 'UI' | 'Mobile';
export interface TestCase {
  id?: number; module: string; tc_ref: string; title: string;
  section: string; type: CaseType; priority: 'High' | 'Medium' | 'Low';
  preconditions: string; steps: string; test_data: string; expected: string; tag?: string;
}
export interface Bug {
  id?: number; title: string; severity: 'Critical' | 'High' | 'Medium' | 'Low';
  module: string; oracle: string; steps: string; expected: string; actual: string;
  found_by: string; evidence?: string;
}
export interface Result { case_id: number; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP'; note?: string; }

/** Track-3 conflict resolution: one agent's evidence contradicts another's finding. */
export type Verdict = 'UPHELD' | 'DOWNGRADED' | 'REJECTED' | 'RECLASSIFIED';
export interface Dispute {
  id?: number;
  bug_id: number;              // the finding under dispute
  raised_by: string;           // agent who filed the finding (e.g. qa-hawk)
  challenged_by: string;       // agent whose evidence contradicts it (e.g. qa-api-tester)
  claim: string;               // the finding as filed
  counter_claim: string;       // the contradicting evidence
  status?: 'OPEN' | 'RESOLVED';
  verdict?: Verdict;           // QA Lead's decision
  rationale?: string;          // why, citing which evidence is stronger
  resolved_by?: string;        // 'qa-lead'
}

export class DB {
  private db: Database.Database;
  constructor(path: string) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS test_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module TEXT NOT NULL, tc_ref TEXT NOT NULL, title TEXT NOT NULL,
        section TEXT NOT NULL, type TEXT NOT NULL, priority TEXT NOT NULL,
        preconditions TEXT NOT NULL, steps TEXT NOT NULL,
        test_data TEXT NOT NULL, expected TEXT NOT NULL,
        tag TEXT, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL, doc_title TEXT, started_at TEXT DEFAULT (datetime('now')),
        finished_at TEXT, verdict TEXT
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL, status TEXT NOT NULL, note TEXT,
        recorded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES test_cases(id)
      );
      CREATE TABLE IF NOT EXISTS bugs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL, severity TEXT NOT NULL, module TEXT NOT NULL,
        oracle TEXT NOT NULL, steps TEXT NOT NULL, expected TEXT NOT NULL, actual TEXT NOT NULL,
        found_by TEXT NOT NULL, evidence TEXT, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS disputes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bug_id INTEGER NOT NULL, raised_by TEXT NOT NULL, challenged_by TEXT NOT NULL,
        claim TEXT NOT NULL, counter_claim TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN', verdict TEXT, rationale TEXT, resolved_by TEXT,
        created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT,
        FOREIGN KEY (bug_id) REFERENCES bugs(id)
      );
    `);
  }

  /** Atomic per-module insert; returns the persisted row id for each case, in order. */
  storeCases(cases: TestCase[]): number[] {
    const stmt = this.db.prepare(
      `INSERT INTO test_cases (module,tc_ref,title,section,type,priority,preconditions,steps,test_data,expected,tag)
       VALUES (@module,@tc_ref,@title,@section,@type,@priority,@preconditions,@steps,@test_data,@expected,@tag)`
    );
    const tx = this.db.transaction((rows: TestCase[]) =>
      rows.map((r) => Number(stmt.run({ tag: null, ...r }).lastInsertRowid))
    );
    return tx(cases);
  }
  listCases(module?: string): TestCase[] {
    return module
      ? (this.db.prepare(`SELECT * FROM test_cases WHERE module=?`).all(module) as TestCase[])
      : (this.db.prepare(`SELECT * FROM test_cases`).all() as TestCase[]);
  }
  fileBug(b: Bug): number {
    return Number(this.db.prepare(
      `INSERT INTO bugs (title,severity,module,oracle,steps,expected,actual,found_by,evidence) VALUES (@title,@severity,@module,@oracle,@steps,@expected,@actual,@found_by,@evidence)`
    ).run({ evidence: null, ...b }).lastInsertRowid);
  }
  listBugs(): Bug[] { return this.db.prepare(`SELECT * FROM bugs ORDER BY id`).all() as Bug[]; }
  getBug(id: number): Bug | undefined { return this.db.prepare(`SELECT * FROM bugs WHERE id=?`).get(id) as Bug | undefined; }
  setBugSeverity(id: number, severity: Bug['severity']) { this.db.prepare(`UPDATE bugs SET severity=? WHERE id=?`).run(severity, id); }

  // --- disputes (Track-3 conflict resolution) ---
  raiseDispute(d: Dispute): number {
    return Number(this.db.prepare(
      `INSERT INTO disputes (bug_id,raised_by,challenged_by,claim,counter_claim) VALUES (@bug_id,@raised_by,@challenged_by,@claim,@counter_claim)`
    ).run(d).lastInsertRowid);
  }
  openDisputes(): Dispute[] { return this.db.prepare(`SELECT * FROM disputes WHERE status='OPEN' ORDER BY id`).all() as Dispute[]; }
  listDisputes(): Dispute[] { return this.db.prepare(`SELECT * FROM disputes ORDER BY id`).all() as Dispute[]; }
  resolveDispute(id: number, verdict: Verdict, rationale: string, resolvedBy = 'qa-lead') {
    this.db.prepare(
      `UPDATE disputes SET status='RESOLVED', verdict=?, rationale=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?`
    ).run(verdict, rationale, resolvedBy, id);
  }
  recordResult(r: Result) {
    this.db.prepare(`INSERT INTO results (case_id,status,note) VALUES (@case_id,@status,@note)`).run({ note: null, ...r });
  }
  results() { return this.db.prepare(`SELECT * FROM results`).all(); }

  /**
   * Clear every run-scoped table so a new run starts from a clean store — the
   * dashboard reads all rows unfiltered, so without this a fresh run shows the
   * previous run's cases/bugs/disputes. Resets AUTOINCREMENT so ids restart at 1
   * (test cases read TC-1, bugs #1, … each run, not continuing from the last).
   */
  reset() {
    this.db.exec(`
      DELETE FROM results;
      DELETE FROM disputes;
      DELETE FROM bugs;
      DELETE FROM test_cases;
      DELETE FROM runs;
      DELETE FROM sqlite_sequence
        WHERE name IN ('results','disputes','bugs','test_cases','runs');
    `);
  }

  startRun(mode: string, docTitle: string): number {
    return Number(this.db.prepare(`INSERT INTO runs (mode,doc_title) VALUES (?,?)`).run(mode, docTitle).lastInsertRowid);
  }
  finishRun(id: number, verdict: string) {
    this.db.prepare(`UPDATE runs SET finished_at=datetime('now'), verdict=? WHERE id=?`).run(verdict, id);
  }
  raw() { return this.db; }
}
