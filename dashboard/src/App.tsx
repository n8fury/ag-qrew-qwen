import { useState } from 'react';
import { proceed, useDashboardData } from './api';
import { ProgressBar } from './components/ProgressBar';
import { SignalFeed } from './components/SignalFeed';
import { CaseBrowser } from './components/CaseBrowser';
import { BugsView } from './components/BugsView';
import { SignOffView } from './components/SignOffView';
import { PlanView } from './components/PlanView';
import { RunConfigView } from './components/RunConfigView';
import { ActivityStrip } from './components/ActivityStrip';

type Tab = 'config' | 'plan' | 'cases' | 'bugs' | 'signoff';

const TILE_TIPS = {
  cases:
    'Structured test cases written by qa-tc-writer from the approved test plan and persisted to SQLite through the tc_store tool. They are the checklist the other agents execute.',
  bugs:
    'Defects filed by worker agents (qa-api-tester, qa-script-writer, qa-hawk) via the bug_file tool when a test or exploration finds a failure. The sub-line counts Critical/High severity.',
  disputes:
    'Conflict resolution (Track 3): when one agent’s evidence contradicts another’s bug, it calls raise_dispute. After one rebuttal round the QA Lead adjudicates — UPHELD, DOWNGRADED, REJECTED, or RECLASSIFIED.',
  results:
    'Test executions recorded via result_record — one PASS / FAIL / BLOCKED / SKIP entry per test-case run (Playwright and API tests). These feed the final sign-off verdict.',
  tokens:
    'Total Qwen tokens consumed by the whole agent society across all five agents. Live tally while a run is in progress; final value comes from qa/metrics.json for comparison with the single-agent baseline.',
} as const;

export default function App() {
  const { state, report, connected, refreshNow } = useDashboardData();
  const [tab, setTab] = useState<Tab>('config');

  const adjudicated = state.disputes.filter((d) => d.status === 'RESOLVED').length;
  const pass = state.results.filter((r) => r.status === 'PASS').length;
  const fail = state.results.filter((r) => r.status === 'FAIL').length;
  // live run total while running (SSE ACTIVITY), metrics.json once finished
  const live = state.running ? state.liveTokens : null;
  const tokens = live ?? report.metrics?.society?.totalTokens;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">AG-QREW on Qwen<small>autonomous QA society · Track 3</small></span>
        <ProgressBar
          phase={state.phase}
          mode={state.mode}
          running={state.running}
          awaitingProceed={state.awaitingProceed}
          verdict={report.metrics?.society?.verdict ?? null}
        />
        <span className={`conn ${connected ? 'ok' : ''}`}>{connected ? '● live' : '○ reconnecting'}</span>
        <span className="spacer" />
        {/* detect-confirm-run: starting happens from the config panel, where the
            capability card shows the mode BEFORE the click (plan Phase D.3) */}
        <button className="btn" disabled={state.running} onClick={() => setTab('config')}>
          ▶ New run
        </button>
        <button
          className={`btn warn${state.awaitingProceed ? ' armed' : ''}`}
          disabled={!state.awaitingProceed}
          onClick={async () => { await proceed(); refreshNow(); }}
        >
          ✓ Approve test plan
        </button>
      </header>

      {state.running && state.activity && <ActivityStrip activity={state.activity} />}

      <div className="tiles">
        <div className="tile" tabIndex={0} data-tip={TILE_TIPS.cases}>
          <div className="label">Test cases</div>
          <div className="value">{state.cases.length}</div>
          <div className="sub">stored via tc_store</div>
        </div>
        <div className="tile" tabIndex={0} data-tip={TILE_TIPS.bugs}>
          <div className="label">Bugs filed</div>
          <div className="value">{state.bugs.length}</div>
          <div className="sub">{state.bugs.filter((b) => b.severity === 'Critical' || b.severity === 'High').length} critical/high</div>
        </div>
        <div className="tile" tabIndex={0} data-tip={TILE_TIPS.disputes}>
          <div className="label">Disputes</div>
          <div className="value">{state.disputes.length}<small>{adjudicated} adjudicated</small></div>
          <div className="sub">conflict resolution</div>
        </div>
        <div className="tile" tabIndex={0} data-tip={TILE_TIPS.results}>
          <div className="label">Results</div>
          <div className="value">{pass}<small>pass</small></div>
          <div className="sub">{fail} fail · {state.results.length} total</div>
        </div>
        <div className="tile" tabIndex={0} data-tip={TILE_TIPS.tokens}>
          <div className="label">Tokens (society)</div>
          <div className="value">{tokens != null ? (tokens / 1000).toFixed(0) + 'k' : '—'}</div>
          <div className="sub">{live != null ? 'live — run in progress' : 'from qa/metrics.json'}</div>
        </div>
      </div>

      <main className="main">
        <SignalFeed signals={state.signals} />
        <div className="panel">
          <div className="panel-head">
            <div className="tabs">
              <button className={`tab${tab === 'config' ? ' active' : ''}`} onClick={() => setTab('config')}>
                Configure
              </button>
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
          {tab === 'config' && (
            <RunConfigView
              running={state.running}
              onStarted={() => { setTab('cases'); refreshNow(); }}
            />
          )}
          {tab === 'plan' && <PlanView awaitingProceed={state.awaitingProceed} />}
          {tab === 'cases' && <CaseBrowser cases={state.cases} results={state.results} />}
          {tab === 'bugs' && <BugsView bugs={state.bugs} disputes={state.disputes} />}
          {tab === 'signoff' && <SignOffView report={report} />}
        </div>
      </main>
    </div>
  );
}
