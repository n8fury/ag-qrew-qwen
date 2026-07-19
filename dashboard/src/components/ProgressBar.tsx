import type { PhaseInfo } from '../types';

/**
 * Segmented pipeline progress bar — replaces the old pulsing "running" dot.
 * Nine fixed segments mirroring orchestrator PHASES (agents/qaLead.ts): the
 * server's PHASE signal is authoritative, this list only supplies short labels.
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
  running: boolean;
  awaitingProceed: boolean;
  /** society verdict from qa/metrics.json, once a run has finished */
  verdict: string | null;
}

export function ProgressBar({ phase, running, awaitingProceed, verdict }: Props) {
  const total = phase?.total ?? SEGMENTS.length;
  const idx = phase?.index ?? 0; // 1-based; 0 = no run yet
  const finished = !running && idx > 0;
  const complete = finished && idx >= total;

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
        {SEGMENTS.map((s, i) => {
          const pos = i + 1;
          // while running the current segment animates; once finished it counts as done
          const cls = pos < idx || (finished && pos === idx) ? 'done'
            : pos === idx ? (awaitingProceed ? 'current awaiting' : 'current')
            : '';
          return <span key={s.id} className={`seg ${cls}`} title={`${pos}. ${s.label}`} />;
        })}
      </span>
      <span className="phasebar-label">
        {label}
        {idx > 0 && !complete && <span className="phasebar-count"> · {idx}/{total}</span>}
      </span>
    </div>
  );
}
