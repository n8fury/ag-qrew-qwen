import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';

/**
 * File-based signal bus — ported verbatim in spirit from AG-QREW's
 * qa/shared-task-list.txt protocol. Append-only, human-readable, demo-friendly,
 * no broker. Every line is one structured signal so the orchestrator and the
 * dashboard read the exact same source of truth.
 *
 * Wire format (one line per signal):
 *   <TYPE>: <payload> | from: <agent> | session: <id> | ts: <iso>
 *
 * Ported signal types (see docs/signals.md):
 *   META         run context (project / sprint / site / api spec) — seeded by the orchestrator
 *   HAWK-ENV     environment READY | BLOCKED (Phase 0 gate)
 *   SECTION-DONE a worker finished a scoped section/module
 *   MODULE-DONE  a per-module unit completed
 *   TC-READY     test cases for a module are available (unblocks downstream)
 *   PROGRESS     heartbeat / status update
 *   BUG-FILED    a bug was recorded
 *   DISPUTE      one agent's evidence contradicts another's finding (Track-3 conflict)
 *   RESOLVED     the QA Lead adjudicated a dispute (verdict on the bus)
 *   BLOCKED      an agent cannot proceed (surfaces to dashboard, never crashes)
 *   DONE         an agent finished its whole task
 *   PHASE        orchestrator marks a pipeline phase start — payload
 *                "<index>/<total>|<id>|<label>", drives the dashboard progress bar
 */
export type SignalType =
  | 'META' | 'HAWK-ENV' | 'SECTION-DONE' | 'MODULE-DONE' | 'TC-READY'
  | 'PROGRESS' | 'BUG-FILED' | 'DISPUTE' | 'RESOLVED' | 'BLOCKED' | 'DONE' | 'PHASE';

export interface Signal {
  type: SignalType;
  payload: string;
  from: string;
  session: string;
  ts: string;
  raw: string;
}

/** Parsed PHASE payload — what /api/state serves and the progress bar renders. */
export interface PhaseInfo { index: number; total: number; id: string; label: string; }

/**
 * Ephemeral per-iteration telemetry (plan-general-inputs Phase F). Emitted
 * IN-MEMORY ONLY via `bus.activity()` — never appended to the bus file: the
 * file is the persistent protocol log, and per-iteration heartbeats would
 * bloat it. The server rebroadcasts these over SSE; nothing else consumes them.
 */
export interface ActivityEvent {
  agent: string;
  iter: number;
  maxIter: number;
  /** the agent's cumulative tokens after this iteration */
  tokensAgent: number;
  /** tokens this iteration cost */
  tokensDelta: number;
  /** short tool-call hints for this iteration, e.g. ["tc_store auth"] */
  calls: string[];
  state: 'working' | 'done' | 'blocked';
  /** run-level running total: every agent's latest cumulative count, summed */
  tokensRun: number;
}

/** Parse a PHASE payload ("3/9|approval|Approval checkpoint"); null if malformed. */
export function parsePhase(payload: string): PhaseInfo | null {
  const m = payload.match(/^(\d+)\/(\d+)\|([\w-]+)\|(.*)$/);
  if (!m) return null;
  return { index: Number(m[1]), total: Number(m[2]), id: m[3], label: m[4] };
}

/** The most recent well-formed PHASE signal in a session's signal list. */
export function latestPhase(signals: Signal[]): PhaseInfo | null {
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i].type !== 'PHASE') continue;
    const p = parsePhase(signals[i].payload);
    if (p) return p;
  }
  return null;
}

export class Bus extends EventEmitter {
  constructor(private path: string, private session: string) {
    super();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) writeFileSync(path, '');
  }

  // Per-agent latest cumulative token counts for the run-level total. A Bus is
  // fresh per run, so summing the map = finished agents' final counts + every
  // live agent's current count (parallel groups sum correctly by construction).
  private agentTokens = new Map<string, number>();

  /**
   * Emit ephemeral activity telemetry — in-memory only, NOTHING is appended to
   * the bus file. Computes and attaches the run-level running token total.
   */
  activity(evt: Omit<ActivityEvent, 'tokensRun'>): ActivityEvent {
    this.agentTokens.set(evt.agent, evt.tokensAgent);
    let tokensRun = 0;
    for (const t of this.agentTokens.values()) tokensRun += t;
    const full: ActivityEvent = { ...evt, tokensRun };
    this.emit('activity', full);
    return full;
  }

  /** Append a signal. Returns the formatted line. */
  write(type: SignalType, payload: string, from: string): Signal {
    const ts = new Date().toISOString();
    const raw = `${type}: ${payload} | from: ${from} | session: ${this.session} | ts: ${ts}`;
    appendFileSync(this.path, raw + '\n');
    const sig: Signal = { type, payload, from, session: this.session, ts, raw };
    this.emit('signal', sig);
    return sig;
  }

  // Incremental-read cache: the bus file is append-only and grows across
  // sessions forever, while readAll() is called constantly (dashboard polling,
  // allDone/blockers checks). Parse each byte once — subsequent reads only
  // consume what was appended since. All sessions are cached; the session
  // filter applies on return.
  private cachedSignals: Signal[] = [];
  private cachedBytes = 0;

  /** All signals for the current session (stale/other-session lines are ignored). */
  readAll(): Signal[] {
    if (!existsSync(this.path)) {
      this.cachedSignals = [];
      this.cachedBytes = 0;
      return [];
    }
    const size = statSync(this.path).size;
    if (size < this.cachedBytes) {
      // file was truncated/replaced externally — start over
      this.cachedSignals = [];
      this.cachedBytes = 0;
    }
    if (size > this.cachedBytes) {
      const fd = openSync(this.path, 'r');
      try {
        const buf = Buffer.alloc(size - this.cachedBytes);
        readSync(fd, buf, 0, buf.length, this.cachedBytes);
        const text = buf.toString('utf8');
        // only consume complete lines — a torn tail stays for the next read
        const lastNl = text.lastIndexOf('\n');
        const complete = lastNl === -1 ? '' : text.slice(0, lastNl + 1);
        this.cachedBytes += Buffer.byteLength(complete, 'utf8');
        for (const line of complete.split('\n')) {
          const s = Bus.parse(line.trim());
          if (s) this.cachedSignals.push(s);
        }
      } finally {
        closeSync(fd);
      }
    }
    return this.cachedSignals.filter((s) => s.session === this.session);
  }

  /** True once every agent in `agents` has emitted a DONE signal this session. */
  allDone(agents: string[]): boolean {
    const done = new Set(this.readAll().filter((s) => s.type === 'DONE').map((s) => s.from));
    return agents.every((a) => done.has(a));
  }

  /** Any BLOCKED signals still outstanding (for the dashboard / sign-off). */
  blockers(): Signal[] {
    return this.readAll().filter((s) => s.type === 'BLOCKED');
  }

  /** DISPUTE signals raised this session (payload = dispute id); the QA Lead adjudicates each. */
  disputes(): Signal[] {
    return this.readAll().filter((s) => s.type === 'DISPUTE');
  }

  static parse(line: string): Signal | null {
    const m = line.match(/^([A-Z-]+):\s*(.*?)\s*\|\s*from:\s*(.*?)\s*\|\s*session:\s*(.*?)\s*\|\s*ts:\s*(.*)$/);
    if (!m) return null;
    return { type: m[1] as SignalType, payload: m[2], from: m[3], session: m[4], ts: m[5], raw: line };
  }
}
