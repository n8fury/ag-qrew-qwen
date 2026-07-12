import type { Bug, Dispute } from '../types';

function DisputeBadge({ d }: { d: Dispute }) {
  const label = d.status === 'RESOLVED' && d.verdict ? d.verdict : 'DISPUTED';
  const cls = d.status === 'RESOLVED' && d.verdict ? `v-${d.verdict}` : 'v-OPEN';
  return <span className={`badge ${cls}`}>⚖ {label}</span>;
}

function BugCard({ bug, disputes }: { bug: Bug; disputes: Dispute[] }) {
  return (
    <div className={`bug-card${disputes.length ? ' disputed' : ''}`}>
      <div className="bug-head">
        <span className={`badge sev-${bug.severity}`}>{bug.severity}</span>
        <span className="title">#{bug.id} {bug.title}</span>
        {disputes.map((d) => <DisputeBadge key={d.id} d={d} />)}
        <span className="who">{bug.module} · by {bug.found_by}</span>
      </div>
      {bug.oracle && (
        <div className="oracle"><span className="k">oracle · </span>{bug.oracle}</div>
      )}
      <details className="bug-more">
        <summary>steps · expected · actual{bug.evidence ? ' · evidence' : ''}</summary>
        <dl className="bug-fields">
          <div><dt>Steps</dt><dd>{bug.steps}</dd></div>
          <div><dt>Expected</dt><dd>{bug.expected}</dd></div>
          <div><dt>Actual</dt><dd>{bug.actual}</dd></div>
          {bug.evidence && <div><dt>Evidence</dt><dd>{bug.evidence}</dd></div>}
        </dl>
      </details>
    </div>
  );
}

function DisputeCard({ d, bug }: { d: Dispute; bug?: Bug }) {
  return (
    <div className="dispute-card">
      <div className="dispute-head">
        <DisputeBadge d={d} />
        <b>Dispute #{d.id}</b>
        <span className="vs">on bug #{d.bug_id}{bug ? ` — ${bug.title}` : ''}</span>
        <span className="vs">{d.challenged_by} challenges {d.raised_by}</span>
      </div>
      <div className="claims">
        <div className="claim">
          <div className="who">claim · {d.raised_by}</div>
          <p>{d.claim}</p>
        </div>
        <div className="claim">
          <div className="who">counter-evidence · {d.challenged_by}</div>
          <p>{d.counter_claim}</p>
        </div>
      </div>
      {d.status === 'RESOLVED' && (
        <div className="rationale">
          <b>{d.resolved_by ?? 'qa-lead'} · {d.verdict}:</b> {d.rationale}
        </div>
      )}
    </div>
  );
}

export function BugsView({ bugs, disputes }: { bugs: Bug[]; disputes: Dispute[] }) {
  const byBug = new Map<number, Dispute[]>();
  for (const d of disputes) {
    byBug.set(d.bug_id, [...(byBug.get(d.bug_id) ?? []), d]);
  }
  return (
    <div className="panel-body">
      {bugs.length === 0 && <div className="empty">no bugs filed yet</div>}
      {bugs.map((b) => <BugCard key={b.id} bug={b} disputes={byBug.get(b.id) ?? []} />)}
      {disputes.length > 0 && (
        <>
          <div className="panel-head" style={{ padding: '10px 0 6px', borderBottom: 'none' }}>
            <h2>Adjudications · Track-3 conflict resolution</h2>
          </div>
          {disputes.map((d) => (
            <DisputeCard key={d.id} d={d} bug={bugs.find((b) => b.id === d.bug_id)} />
          ))}
        </>
      )}
    </div>
  );
}
