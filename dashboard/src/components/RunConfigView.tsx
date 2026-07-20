import { useEffect, useRef, useState } from 'react';
import { fetchPreset, fetchPreview, startRun, type Preset, type Preview } from '../api';
import type { RunCtx } from '../types';

/**
 * Run-configuration panel (plan-general-inputs Phase D) — detect, confirm, run.
 * The user supplies any subset of (target URL, requirements doc, OpenAPI spec);
 * a debounced POST /api/preview renders the resulting mode as a capability card
 * (detected inputs, will/won't do, unlock hints). The card IS the confirmation:
 * the Start button carries the mode label, no extra dialog. Prefilled from
 * GET /api/preset (the bundled demo target); "Reset to demo" re-fetches it.
 */

/** Editable form state — strings throughout; assembled into a RunCtx on start. */
interface Cfg {
  project: string;
  sprint: string;
  site: string;
  docText: string;
  siteMap: string;
  modules: string[];
  adminEmail: string;
  adminPassword: string;
  userEmail: string;
  userPassword: string;
  appNotes: string;
  oracleApi: string;
  oracleExplore: string;
}

const EMPTY_CFG: Cfg = {
  project: '', sprint: '1', site: '', docText: '', siteMap: '', modules: [],
  adminEmail: '', adminPassword: '', userEmail: '', userPassword: '',
  appNotes: '', oracleApi: '', oracleExplore: '',
};

interface SpecFile {
  name: string;
  text: string;
}

function cfgFromPreset(p: Preset): { cfg: Cfg; spec: SpecFile | null } {
  const c = p.ctx;
  return {
    cfg: {
      project: c.project ?? '',
      sprint: String(c.sprint ?? 1),
      site: c.site ?? '',
      docText: c.docText ?? '',
      siteMap: c.siteMap ?? '',
      modules: c.modules ?? [],
      adminEmail: c.creds?.adminEmail ?? '',
      adminPassword: c.creds?.adminPassword ?? '',
      userEmail: c.creds?.userEmail ?? '',
      userPassword: c.creds?.userPassword ?? '',
      appNotes: c.appNotes ?? '',
      oracleApi: c.priorityOracles?.api ?? '',
      oracleExplore: c.priorityOracles?.explore ?? '',
    },
    spec: p.specYaml ? { name: 'openapi.yaml (bundled demo spec)', text: p.specYaml } : null,
  };
}

/** Assemble the RunCtx to POST — empty optional fields are omitted, not sent as ''. */
function buildCtx(cfg: Cfg): RunCtx {
  const ctx: RunCtx = {
    project: cfg.project.trim() || 'Untitled project',
    sprint: Math.max(1, Math.trunc(Number(cfg.sprint)) || 1),
    modules: cfg.modules,
  };
  if (cfg.site.trim()) ctx.site = cfg.site.trim();
  if (cfg.docText.trim()) ctx.docText = cfg.docText;
  if (cfg.siteMap.trim()) ctx.siteMap = cfg.siteMap;
  const creds: NonNullable<RunCtx['creds']> = {};
  if (cfg.adminEmail.trim()) creds.adminEmail = cfg.adminEmail.trim();
  if (cfg.adminPassword) creds.adminPassword = cfg.adminPassword;
  if (cfg.userEmail.trim()) creds.userEmail = cfg.userEmail.trim();
  if (cfg.userPassword) creds.userPassword = cfg.userPassword;
  if (Object.keys(creds).length > 0) ctx.creds = creds;
  if (cfg.appNotes.trim()) ctx.appNotes = cfg.appNotes;
  const oracles: NonNullable<RunCtx['priorityOracles']> = {};
  if (cfg.oracleApi.trim()) oracles.api = cfg.oracleApi;
  if (cfg.oracleExplore.trim()) oracles.explore = cfg.oracleExplore;
  if (Object.keys(oracles).length > 0) ctx.priorityOracles = oracles;
  return ctx;
}

function readTextFile(f: File, cb: (text: string) => void) {
  const r = new FileReader();
  r.onload = () => cb(String(r.result ?? ''));
  r.readAsText(f);
}

interface Props {
  running: boolean;
  /** run accepted by the server — App switches to the cases tab and refetches */
  onStarted: () => void;
}

export function RunConfigView({ running, onStarted }: Props) {
  const [cfg, setCfg] = useState<Cfg>(EMPTY_CFG);
  const [spec, setSpec] = useState<SpecFile | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [moduleDraft, setModuleDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const loaded = useRef(false);

  const set = <K extends keyof Cfg>(key: K, val: Cfg[K]) => setCfg((c) => ({ ...c, [key]: val }));

  // prefill once from the server's canonical demo preset (C.4)
  useEffect(() => {
    fetchPreset().then((p) => {
      setPreset(p);
      if (p && !loaded.current) {
        loaded.current = true;
        const { cfg: c, spec: s } = cfgFromPreset(p);
        setCfg(c);
        setSpec(s);
      }
    });
  }, []);

  // live capability card (D.2): debounce detectMode over the three inputs
  useEffect(() => {
    const t = setTimeout(async () => {
      setPreview(await fetchPreview({ site: cfg.site, docText: cfg.docText }, spec !== null));
    }, 350);
    return () => clearTimeout(t);
  }, [cfg.site, cfg.docText, spec]);

  const resetToDemo = () => {
    if (!preset) return;
    const { cfg: c, spec: s } = cfgFromPreset(preset);
    setCfg(c);
    setSpec(s);
    setStartError(null);
  };

  const addModule = () => {
    const m = moduleDraft.trim();
    if (m && !cfg.modules.includes(m)) set('modules', [...cfg.modules, m]);
    setModuleDraft('');
  };

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const r = await startRun({ ctx: buildCtx(cfg), ...(spec ? { specYaml: spec.text } : {}) });
      if (r.ok) {
        onStarted();
      } else {
        const j = await r.json().catch(() => null);
        setStartError(j?.error ?? `server returned ${r.status}`);
      }
    } catch {
      setStartError('server unreachable');
    }
    setStarting(false);
  };

  const mode = preview?.ok ? preview.mode ?? null : null;
  const fieldErrors = preview?.fieldErrors ?? {};
  const noModules = cfg.modules.length === 0;
  const canStart = !running && !starting && mode !== null && !noModules
    && Object.keys(fieldErrors).length === 0;

  return (
    <div className="panel-body">
      <div className="cfg">
        <div className="cfg-form">
          <div className="cfg-row">
            <div className="cfg-field">
              <label htmlFor="cfg-project">Project</label>
              <input id="cfg-project" type="text" value={cfg.project}
                onChange={(e) => set('project', e.target.value)} placeholder="My web app" />
            </div>
            <div className="cfg-field">
              <label htmlFor="cfg-sprint">Sprint</label>
              <input id="cfg-sprint" type="number" min={1} value={cfg.sprint}
                onChange={(e) => set('sprint', e.target.value)} />
            </div>
          </div>

          <div className="cfg-field">
            <label htmlFor="cfg-site">Target URL</label>
            <input id="cfg-site" type="text" className={fieldErrors.site ? 'invalid' : ''}
              value={cfg.site} onChange={(e) => set('site', e.target.value)}
              placeholder="https://staging.example.com — leave empty for a design-only run" />
            {fieldErrors.site && <div className="field-err">{fieldErrors.site}</div>}
          </div>

          <div className="cfg-field">
            <label htmlFor="cfg-doc">Requirements / release notes</label>
            <textarea id="cfg-doc" rows={9} className={fieldErrors.docText ? 'invalid' : ''}
              value={cfg.docText} onChange={(e) => set('docText', e.target.value)} spellCheck={false}
              placeholder="Paste the requirements the agents should test against — or load a file below" />
            {fieldErrors.docText && <div className="field-err">{fieldErrors.docText}</div>}
            <div className="file-pick">
              <label className="btn ghost file-btn">
                Load .txt / .md…
                <input type="file" accept=".txt,.md,text/plain,text/markdown"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readTextFile(f, (text) => set('docText', text));
                    e.target.value = '';
                  }} />
              </label>
              <span className="field-note">read locally into the textarea — nothing uploads until Start</span>
            </div>
          </div>

          <div className="cfg-field">
            <label>OpenAPI spec</label>
            <div className="file-pick">
              <label className="btn ghost file-btn">
                Choose .yaml / .yml / .json…
                <input type="file" accept=".yaml,.yml,.json,application/yaml,application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readTextFile(f, (text) => setSpec({ name: f.name, text }));
                    e.target.value = '';
                  }} />
              </label>
              {spec ? (
                <span className="chip">
                  <code>{spec.name}</code>
                  <button title="remove spec" onClick={() => setSpec(null)}>×</button>
                </span>
              ) : (
                <span className="field-note">no spec — API contract testing stays locked</span>
              )}
            </div>
          </div>

          <div className="cfg-field">
            <label htmlFor="cfg-modules">In-scope modules</label>
            <div className="chips">
              {cfg.modules.map((m) => (
                <span key={m} className="chip">
                  {m}
                  <button title={`remove ${m}`}
                    onClick={() => set('modules', cfg.modules.filter((x) => x !== m))}>×</button>
                </span>
              ))}
              <input id="cfg-modules" type="text" value={moduleDraft} placeholder="add module ⏎"
                onChange={(e) => setModuleDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addModule(); } }}
                onBlur={addModule} />
            </div>
            {noModules && <div className="field-err">at least one module is required</div>}
          </div>

          <div className="cfg-row">
            <div className="cfg-field">
              <label htmlFor="cfg-admin-email">Admin login</label>
              <input id="cfg-admin-email" type="text" value={cfg.adminEmail} placeholder="email"
                onChange={(e) => set('adminEmail', e.target.value)} />
              <input aria-label="admin password" type="text" value={cfg.adminPassword} placeholder="password"
                onChange={(e) => set('adminPassword', e.target.value)} />
            </div>
            <div className="cfg-field">
              <label htmlFor="cfg-user-email">Standard-user login</label>
              <input id="cfg-user-email" type="text" value={cfg.userEmail} placeholder="email"
                onChange={(e) => set('userEmail', e.target.value)} />
              <input aria-label="user password" type="text" value={cfg.userPassword} placeholder="password"
                onChange={(e) => set('userPassword', e.target.value)} />
            </div>
          </div>

          <div className="cfg-field">
            <label htmlFor="cfg-sitemap">Site map (documented entry points)</label>
            <textarea id="cfg-sitemap" rows={2} value={cfg.siteMap} spellCheck={false}
              onChange={(e) => set('siteMap', e.target.value)}
              placeholder="login = / · dashboard = /home · REST API under /api" />
          </div>

          <details className="cfg-advanced">
            <summary>Advanced — app notes &amp; priority oracles</summary>
            <div className="cfg-field">
              <label htmlFor="cfg-notes">App notes (guidance for the script writer / explorer)</label>
              <textarea id="cfg-notes" rows={4} value={cfg.appNotes} spellCheck={false}
                onChange={(e) => set('appNotes', e.target.value)}
                placeholder="Known-absent features, redirect quirks — target-specific facts the agents must trust" />
            </div>
            <div className="cfg-field">
              <label htmlFor="cfg-oracle-api">Priority oracles — API tester</label>
              <textarea id="cfg-oracle-api" rows={4} value={cfg.oracleApi} spellCheck={false}
                onChange={(e) => set('oracleApi', e.target.value)}
                placeholder="Must-check API claims from the requirements, run before the generic battery" />
            </div>
            <div className="cfg-field">
              <label htmlFor="cfg-oracle-explore">Priority oracles — exploratory</label>
              <textarea id="cfg-oracle-explore" rows={4} value={cfg.oracleExplore} spellCheck={false}
                onChange={(e) => set('oracleExplore', e.target.value)}
                placeholder="Must-check UI claims, verified before free exploration" />
            </div>
          </details>
        </div>

        <div className="mode-card">
          <div className="mode-head">
            <h3>{mode ? mode.label : 'No runnable inputs'}</h3>
            <button className="btn ghost" onClick={resetToDemo} disabled={!preset}>Reset to demo</button>
          </div>

          <div className="mode-inputs">
            <ModeInput on={mode?.detected.site ?? false} label="Target URL" />
            <ModeInput on={mode?.detected.docText ?? false} label="Requirements doc" />
            <ModeInput on={mode?.detected.spec ?? false} label="OpenAPI spec" />
          </div>

          {preview === null && <div className="field-note">preview unavailable — is the server reachable?</div>}
          {preview && !preview.ok && <div className="field-err">{preview.error}</div>}

          {mode && (
            <>
              <ul className="mode-list will">
                {mode.willDo.map((w) => <li key={w}>{w}</li>)}
              </ul>
              {mode.wontDo.length > 0 && (
                <ul className="mode-list wont">
                  {mode.wontDo.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
              {mode.unlocks.map((u) => <div key={u} className="unlock">{u}</div>)}
            </>
          )}

          <button className="btn start" disabled={!canStart} onClick={start}>
            {starting ? 'starting…'
              : running ? 'a run is in progress'
              : mode ? `▶ Start run — ${mode.label}`
              : '▶ Start run'}
          </button>
          {startError && <div className="field-err">{startError}</div>}
        </div>
      </div>
    </div>
  );
}

function ModeInput({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`mode-in ${on ? 'on' : 'off'}`}>
      <b>{on ? '✓' : '✗'}</b> {label}
    </span>
  );
}
