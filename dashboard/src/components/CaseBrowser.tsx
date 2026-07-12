import { useMemo, useState } from 'react';
import type { Result, TestCase } from '../types';

const DETAIL_FIELDS: Array<[keyof TestCase, string]> = [
  ['preconditions', 'Preconditions'],
  ['steps', 'Steps'],
  ['test_data', 'Test data'],
  ['expected', 'Expected'],
];

export function CaseBrowser({ cases, results }: { cases: TestCase[]; results: Result[] }) {
  const [module, setModule] = useState('all');
  const [type, setType] = useState('all');
  const [priority, setPriority] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const modules = useMemo(() => [...new Set(cases.map((c) => c.module))].sort(), [cases]);
  const types = useMemo(() => [...new Set(cases.map((c) => c.type))].sort(), [cases]);

  // latest recorded result per case (executors may re-run a case)
  const latestResult = useMemo(() => {
    const m = new Map<number, Result>();
    for (const r of results) m.set(r.case_id, r);
    return m;
  }, [results]);

  const shown = cases.filter((c) =>
    (module === 'all' || c.module === module) &&
    (type === 'all' || c.type === type) &&
    (priority === 'all' || c.priority === priority) &&
    (!q || `${c.tc_ref} ${c.title} ${c.section}`.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <>
      <div className="filters">
        <select value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="all">module: all</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">type: all</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="all">priority: all</option>
          {['High', 'Medium', 'Low'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input placeholder="search title / ref / section…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="panel-body">
        {shown.length === 0 && (
          <div className="empty">
            {cases.length === 0 ? 'no test cases stored yet — qa-tc-writer fills this table' : 'no cases match the filters'}
          </div>
        )}
        {shown.map((c) => {
          const res = latestResult.get(c.id);
          const isOpen = open === c.id;
          return (
            <div className="case-row" key={c.id}>
              <button className="case-line" onClick={() => setOpen(isOpen ? null : c.id)}>
                <span className="ref">{c.tc_ref || `#${c.id}`}</span>
                <span className="mod">[{c.module}]</span>
                <span className="title">{c.title}</span>
                {res && <span className={`badge res-${res.status}`}>{res.status}</span>}
                <span className="meta">{c.type} · {c.priority}</span>
              </button>
              {isOpen && (
                <dl className="case-detail">
                  {DETAIL_FIELDS.map(([key, label]) => {
                    const v = c[key];
                    return v ? (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ) : null;
                  })}
                  {res?.note && (
                    <div>
                      <dt>Result note</dt>
                      <dd>{res.note}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
