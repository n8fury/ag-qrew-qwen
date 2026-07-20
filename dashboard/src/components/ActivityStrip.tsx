import { useEffect, useRef, useState } from 'react';
import type { ActivityEvent } from '../types';
import { humanizeHint } from '../../../orchestrator/src/humanize';

/**
 * Live agent telemetry strip (plan-general-inputs F.3) — surfaces the CLI's
 * per-iteration lines in the dashboard: current agent, iteration k/N, the last
 * tool hint (humanized via the shared map), and a count-up token counter.
 * Rendered only mid-run; the parent hides it when idle/finished.
 */

/** Animate a number towards `target`; jumps straight there under prefers-reduced-motion. */
export function useCountUp(target: number, durationMs = 450): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    from.current = target;
    if (start === target) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const p = Math.min(1, (t - t0) / durationMs);
      setShown(Math.round(start + (target - start) * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return shown;
}

const STATE_LABEL: Record<ActivityEvent['state'], string> = {
  working: '', // the hint says what it's doing
  done: 'finished its task',
  blocked: 'blocked',
};

export function ActivityStrip({ activity }: { activity: ActivityEvent }) {
  const tokens = useCountUp(activity.tokensRun);
  const lastCall = activity.calls[activity.calls.length - 1];
  const doing = activity.state === 'working'
    ? (lastCall ? humanizeHint(lastCall) : 'thinking…')
    : STATE_LABEL[activity.state];

  return (
    <div className={`activity-strip ${activity.state}`} role="status" aria-live="polite">
      <span className="agent">{activity.agent}</span>
      <span className="iter">iteration {activity.iter}/{activity.maxIter}</span>
      <span className="doing">{doing}</span>
      <span className="spacer" />
      <span className="tokens">{tokens.toLocaleString()} tok</span>
    </div>
  );
}
