/** Mirrors the server's /api/state and /api/report payloads (see orchestrator/src/server.ts). */

export type SignalType =
  | 'META' | 'HAWK-ENV' | 'SECTION-DONE' | 'MODULE-DONE' | 'TC-READY'
  | 'PROGRESS' | 'BUG-FILED' | 'DISPUTE' | 'RESOLVED' | 'BLOCKED' | 'DONE' | 'HELLO';

export interface Signal {
  type: SignalType;
  payload: string;
  from: string;
  session: string;
  ts: string;
  raw: string;
}

export type Priority = 'High' | 'Medium' | 'Low';
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface TestCase {
  id: number;
  module: string;
  tc_ref: string;
  title: string;
  section: string;
  type: string;
  priority: Priority;
  preconditions: string;
  steps: string;
  test_data: string;
  expected: string;
  tag?: string | null;
  created_at?: string;
}

export interface Bug {
  id: number;
  title: string;
  severity: Severity;
  module: string;
  oracle: string;
  steps: string;
  expected: string;
  actual: string;
  found_by: string;
  evidence?: string | null;
  created_at?: string;
}

export type DisputeVerdict = 'UPHELD' | 'DOWNGRADED' | 'REJECTED' | 'RECLASSIFIED';

export interface Dispute {
  id: number;
  bug_id: number;
  raised_by: string;
  challenged_by: string;
  claim: string;
  counter_claim: string;
  status: 'OPEN' | 'RESOLVED';
  verdict?: DisputeVerdict | null;
  rationale?: string | null;
  resolved_by?: string | null;
  created_at?: string;
  resolved_at?: string | null;
}

export type ResultStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP';

export interface Result {
  id: number;
  case_id: number;
  status: ResultStatus;
  note?: string | null;
  recorded_at?: string;
}

export interface State {
  running: boolean;
  awaitingProceed: boolean;
  signals: Signal[];
  cases: TestCase[];
  bugs: Bug[];
  disputes: Dispute[];
  results: Result[];
}

export interface ModeMetrics {
  mode: string;
  wallClockMs: number;
  totalTokens: number;
  bugs: number;
  disputes: number;
  testCases: number;
  results: { pass: number; fail: number; blocked: number; skip: number };
  verdict: string | null;
}

export interface Report {
  signOff: string | null;
  metrics: Record<string, ModeMetrics> | null;
}

export const EMPTY_STATE: State = {
  running: false,
  awaitingProceed: false,
  signals: [],
  cases: [],
  bugs: [],
  disputes: [],
  results: [],
};
