import { useState } from 'react';
import type { Signal, SignalType } from '../types';

const FILTERS: Record<string, SignalType[] | null> = {
  'all signals': null,
  'bugs & disputes': ['BUG-FILED', 'DISPUTE', 'RESOLVED'],
  'milestones': ['HAWK-ENV', 'TC-READY', 'SECTION-DONE', 'MODULE-DONE', 'DONE', 'BLOCKED'],
};

export function SignalFeed({ signals }: { signals: Signal[] }) {
  const [filter, setFilter] = useState('all signals');
  const allow = FILTERS[filter];
  const shown = (allow ? signals.filter((s) => allow.includes(s.type)) : signals).slice().reverse();

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Signal bus · live</h2>
        <select className="feed-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {Object.keys(FILTERS).map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      <div className="panel-body">
        {shown.length === 0 && <div className="empty">no signals yet — start a run</div>}
        {shown.map((s, i) => (
          <div className="sig" key={`${s.ts}-${i}`}>
            <span className={`sig-type t-${s.type}`}>{s.type}</span>
            <span className="payload">
              {s.payload} <span className="from">· {s.from}</span>
            </span>
            <time>{s.ts.slice(11, 19)}</time>
          </div>
        ))}
      </div>
    </div>
  );
}
