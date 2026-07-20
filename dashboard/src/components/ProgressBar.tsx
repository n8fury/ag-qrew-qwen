import type { ModeState, PhaseInfo } from '../types';

/**
 * Segmented pipeline progress bar — replaces the old pulsing "running" dot.
 * Nine fixed segments mirroring orchestrator PHASES (src/mode.ts): the server's
 * PHASE signal is authoritative, this list only supplies short labels.
 *
 * Mode-aware (plan Phase E.1): segments outside the active mode render as
 * `skipped` (dim/hatched); PHASE index/total are active-relative, so a design
 * run counts 1/4..4/4 across its four live segments. A null mode (server
 * restarted mid-history) falls back to the all-active rendering.
 */
const SEGMENTS = [
  { id: 'env', label: 'Env gate' },
  { id: 'plan', label: 'Test plan' },
  { id: 'approval', label: 'Approval' },
  { id: 'cases', label: 'Test cases' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'explore', label: 'Explore' },
  { id: 'api', label: 'API tests' },
  { id: 'adjudicate', label: 'Adjudicate' },
  { id: 'signoff', label: 'Sign-off' },
];

interface Props {
  phase: PhaseInfo | null;
  /** active run's mode from /api/state — null means unknown (render all segments active) */
  mode: ModeState | null;
  running: boolean;
  awaitingProceed: boolean;
  /** society verdict from qa/metrics.json, once a run has finished */
  verdict: string | null;
}

export function ProgressBar({ phase, mode, running, awaitingProceed, verdict }: Props) {
  const activeIds = mode?.phases ?? SEGMENTS.map((s) => s.id);
  const total = phase?.total ?? activeIds.length;
  const idx = phase?.index ?? 0; // 1-based within ACTIVE phases; 0 = no run yet
  const finished = !running && idx > 0;
  const complete = finished && idx >= total;

  // DESIGN COMPLETE (±WITH FINDINGS) is a completion, not a pass/fail call —
  // green family, same as PASS (the label still carries the findings note)
  const verdictCls = !finished || !verdict ? ''
    : verdict.startsWith('FAIL') ? 'v-fail'
    : verdict.startsWith('CONDITIONAL') ? 'v-cond'
    : 'v-pass';

  const label = awaitingProceed ? 'awaiting your approval'
    : running ? (phase ? phase.label : 'starting…')
    : complete ? `complete — ${verdict ?? 'see sign-off'}`
    : finished ? `stopped at ${phase!.label}${verdict ? ` — ${verdict}` : ''}`
    : 'idle';

  return (
    <div
      className={`phasebar ${verdictCls}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={idx}
      aria-label={`pipeline: ${label}`}
    >
      <span className="segs">
        {SEGMENTS.map((s) => {
          const ai = activeIds.indexOf(s.id); // -1 → not part of this mode
          if (ai === -1) {
            return (
              <span key={s.id} className="seg skipped"
                title={`${s.label} — skipped: not available with the provided inputs`} />
            );
          }
          const pos = ai + 1; // 1-based position among ACTIVE segments (matches PHASE index)
          // while running the current segment animates; once finished it counts as done
          const cls = pos < idx || (finished && pos === idx) ? 'done'
            : pos === idx ? (awaitingProceed ? 'current awaiting' : 'current')
            : '';
          return <span key={s.id} className={`seg ${cls}`} title={`${pos}/${total} ${s.label}`} />;
        })}
      </span>
      <span className="phasebar-label">
        {label}
        {idx > 0 && !complete && <span className="phasebar-count"> · {idx}/{total}</span>}
      </span>
    </div>
  );
}
