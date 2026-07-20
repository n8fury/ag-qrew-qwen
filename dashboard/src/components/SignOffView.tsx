import type { ModeMetrics, Report } from '../types';

const ROWS: Array<[string, (m: ModeMetrics) => string]> = [
  ['Test cases', (m) => String(m.testCases)],
  ['Bugs filed', (m) => String(m.bugs)],
  ['Disputes', (m) => String(m.disputes)],
  ['Results (pass/fail)', (m) => `${m.results.pass} / ${m.results.fail}`],
  ['Total tokens', (m) => m.totalTokens.toLocaleString()],
  ['Wall-clock', (m) => `${(m.wallClockMs / 60000).toFixed(1)} min`],
  ['Verdict', (m) => m.verdict ?? '—'],
];

/** Banner class + label from the report text; design completions tint green like PASS. */
function detectVerdict(text: string): { cls: 'PASS' | 'CONDITIONAL' | 'FAIL'; label: string } | null {
  const d = text.match(/DESIGN COMPLETE(?:\s*—\s*WITH FINDINGS)?/i);
  if (d) return { cls: 'PASS', label: d[0].toUpperCase() };
  const m = text.match(/verdict\s*[:—-]?\s*(PASS|CONDITIONAL(?:\s+PASS)?|FAIL)/i);
  if (!m) return null;
  const v = m[1].toUpperCase();
  return v.startsWith('CONDITIONAL')
    ? { cls: 'CONDITIONAL', label: 'CONDITIONAL' }
    : { cls: v as 'PASS' | 'FAIL', label: v };
}

export function SignOffView({ report }: { report: Report }) {
  const { signOff, metrics } = report;
  const modes = metrics ? Object.values(metrics) : [];
  const verdict = signOff ? detectVerdict(signOff) : null;

  return (
    <div className="panel-body">
      {modes.length > 0 && (
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Metric</th>
              {modes.map((m) => <th key={m.mode}>{m.mode === 'society' ? 'Society (5 agents)' : 'Single agent'}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, fmt]) => (
              <tr key={label}>
                <td>{label}</td>
                {modes.map((m) => <td key={m.mode}>{fmt(m)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {verdict && <div className={`verdict-banner ${verdict.cls}`}>QA Lead verdict · {verdict.label}</div>}
      {signOff
        ? <pre className="signoff-pre">{signOff}</pre>
        : <div className="empty">no sign-off report yet — written by qa-lead in Phase 4 (qa/sign-off-report.txt)</div>}
    </div>
  );
}
