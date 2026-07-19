import { useState } from 'react';
import { proceed, startRun, useDashboardData } from './api';
import { ProgressBar } from './components/ProgressBar';
import { SignalFeed } from './components/SignalFeed';
import { CaseBrowser } from './components/CaseBrowser';
import { BugsView } from './components/BugsView';
import { SignOffView } from './components/SignOffView';
import { PlanView } from './components/PlanView';

type Tab = 'plan' | 'cases' | 'bugs' | 'signoff';

export default function App() {
  const { state, report, connected, refreshNow } = useDashboardData();
  const [tab, setTab] = useState<Tab>('cases');

  const adjudicated = state.disputes.filter((d) => d.status === 'RESOLVED').length;
  const pass = state.results.filter((r) => r.status === 'PASS').length;
  const fail = state.results.filter((r) => r.status === 'FAIL').length;
  const tokens = report.metrics?.society?.totalTokens;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">AG-QREW on Qwen<small>autonomous QA society · Track 3</small></span>
        <ProgressBar
          phase={state.phase}
          running={state.running}
          awaitingProceed={state.awaitingProceed}
          verdict={report.metrics?.society?.verdict ?? null}
        />
        <span className={`conn ${connected ? 'ok' : ''}`}>{connected ? '● live' : '○ reconnecting'}</span>
        <span className="spacer" />
        <button className="btn" disabled={state.running} onClick={async () => { await startRun(); refreshNow(); }}>
          ▶ Start run
        </button>
        <button
          className={`btn warn${state.awaitingProceed ? ' armed' : ''}`}
          disabled={!state.awaitingProceed}
          onClick={async () => { await proceed(); refreshNow(); }}
        >
          ✓ Approve test plan
        </button>
      </header>

      <div className="tiles">
        <div className="tile">
          <div className="label">Test cases</div>
          <div className="value">{state.cases.length}</div>
          <div className="sub">stored via tc_store</div>
        </div>
        <div className="tile">
          <div className="label">Bugs filed</div>
          <div className="value">{state.bugs.length}</div>
          <div className="sub">{state.bugs.filter((b) => b.severity === 'Critical' || b.severity === 'High').length} critical/high</div>
        </div>
        <div className="tile">
          <div className="label">Disputes</div>
          <div className="value">{state.disputes.length}<small>{adjudicated} adjudicated</small></div>
          <div className="sub">conflict resolution</div>
        </div>
        <div className="tile">
          <div className="label">Results</div>
          <div className="value">{pass}<small>pass</small></div>
          <div className="sub">{fail} fail · {state.results.length} total</div>
        </div>
        <div className="tile">
          <div className="label">Tokens (society)</div>
          <div className="value">{tokens != null ? (tokens / 1000).toFixed(0) + 'k' : '—'}</div>
          <div className="sub">from qa/metrics.json</div>
        </div>
      </div>

      <main className="main">
        <SignalFeed signals={state.signals} />
        <div className="panel">
          <div className="panel-head">
            <div className="tabs">
              <button className={`tab${tab === 'plan' ? ' active' : ''}`} onClick={() => setTab('plan')}>
                Test plan{state.awaitingProceed && <span className="count">!</span>}
              </button>
              <button className={`tab${tab === 'cases' ? ' active' : ''}`} onClick={() => setTab('cases')}>
                Test cases<span className="count">{state.cases.length}</span>
              </button>
              <button className={`tab${tab === 'bugs' ? ' active' : ''}`} onClick={() => setTab('bugs')}>
                Bugs &amp; disputes<span className="count">{state.bugs.length}</span>
              </button>
              <button className={`tab${tab === 'signoff' ? ' active' : ''}`} onClick={() => setTab('signoff')}>
                Sign-off
              </button>
            </div>
          </div>
          {tab === 'plan' && <PlanView awaitingProceed={state.awaitingProceed} />}
          {tab === 'cases' && <CaseBrowser cases={state.cases} results={state.results} />}
          {tab === 'bugs' && <BugsView bugs={state.bugs} disputes={state.disputes} />}
          {tab === 'signoff' && <SignOffView report={report} />}
        </div>
      </main>
    </div>
  );
}
