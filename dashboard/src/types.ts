/** Mirrors the server's /api/state and /api/report payloads (see orchestrator/src/server.ts). */

export type SignalType =
  | 'META' | 'HAWK-ENV' | 'SECTION-DONE' | 'MODULE-DONE' | 'TC-READY'
  | 'PROGRESS' | 'BUG-FILED' | 'DISPUTE' | 'RESOLVED' | 'BLOCKED' | 'DONE' | 'PHASE' | 'HELLO';

/** Pipeline position from the orchestrator's PHASE signals (1-based index). */
export interface PhaseInfo {
  index: number;
  total: number;
  id: string;
  label: string;
}

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

/** Active run's detected mode from /api/state (mirrors orchestrator/src/mode.ts ModeState). */
export interface ModeState {
  modeId: string;
  label: string;
  phases: string[];
}

/** Full detectMode output from POST /api/preview (mirrors orchestrator/src/mode.ts RunMode). */
export interface RunMode extends ModeState {
  detected: { site: boolean; docText: boolean; spec: boolean };
  willDo: string[];
  wontDo: string[];
  unlocks: string[];
}

/** Run inputs (mirrors orchestrator RunContext — the shape /api/preset returns and /api/run accepts). */
export interface RunCtx {
  project: string;
  sprint: number;
  site?: string;
  apiSpecPath?: string;
  modules: string[];
  creds?: { adminEmail?: string; adminPassword?: string; userEmail?: string; userPassword?: string };
  docText?: string;
  siteMap?: string;
  appNotes?: string;
  priorityOracles?: { api?: string; explore?: string };
}

/** Ephemeral per-iteration agent telemetry (mirrors orchestrator/src/bus.ts ActivityEvent). */
export interface ActivityEvent {
  agent: string;
  iter: number;
  maxIter: number;
  tokensAgent: number;
  tokensDelta: number;
  calls: string[];
  state: 'working' | 'done' | 'blocked';
  tokensRun: number;
}

export interface State {
  running: boolean;
  awaitingProceed: boolean;
  phase: PhaseInfo | null;
  /** null once the server restarts — the progress bar falls back to all-active rendering */
  mode: ModeState | null;
  /** latest agent activity — non-null only mid-run; SSE ACTIVITY events update it live */
  activity: ActivityEvent | null;
  /** running run-token total mid-run; null after the run (metrics.json takes over) */
  liveTokens: number | null;
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
  phase: null,
  mode: null,
  activity: null,
  liveTokens: null,
  signals: [],
  cases: [],
  bugs: [],
  disputes: [],
  results: [],
};
