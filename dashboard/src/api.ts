import { useEffect, useRef, useState } from 'react';
import { EMPTY_STATE, type ActivityEvent, type Report, type RunCtx, type RunMode, type Signal, type State } from './types';

export async function fetchState(): Promise<State> {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error(`GET /api/state → ${r.status}`);
  return r.json();
}

export async function fetchReport(): Promise<Report> {
  const r = await fetch('/api/report');
  if (!r.ok) return { signOff: null, metrics: null };
  return r.json();
}

/**
 * Optional auth for servers started with AGQREW_TOKEN (remote demos): the token
 * arrives once as ?token=… in the URL (then persists in localStorage), and every
 * mutating request carries it as a header. Local runs without a token are a no-op.
 */
function authHeaders(): Record<string, string> {
  const fromUrl = new URLSearchParams(window.location.search).get('token');
  if (fromUrl) {
    localStorage.setItem('agqrew_token', fromUrl);
    history.replaceState(null, '', window.location.pathname); // keep the secret out of the address bar
  }
  const token = localStorage.getItem('agqrew_token');
  return token ? { 'X-AGQREW-TOKEN': token } : {};
}

/**
 * Start a run with the configured inputs (Phase D.3). `ctx` is the run context
 * from the config panel; `specYaml` rides along when a spec file was chosen —
 * the server writes it to qa/openapi.yaml before phase 1. A body-less call keeps
 * the old behaviour (server-side demo preset).
 */
export const startRun = (body?: { ctx: RunCtx; specYaml?: string }) =>
  fetch('/api/run', {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json', ...authHeaders() } : authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
export const proceed = () => fetch('/api/proceed', { method: 'POST', headers: authHeaders() });

/** GET /api/preset — the bundled demo target the panel prefills from (Phase C.4). */
export interface Preset {
  ctx: RunCtx;
  specYaml: string | null;
}

export async function fetchPreset(): Promise<Preset | null> {
  try {
    const r = await fetch('/api/preset');
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/**
 * POST /api/preview — detectMode over the current inputs, no side effects
 * (Phase C.1). 200 carries the mode; 400 means the empty input set. Both carry
 * per-field validation errors for inline display.
 */
export interface Preview {
  ok: boolean;
  mode?: RunMode;
  fieldErrors: Record<string, string>;
  error?: string;
}

export async function fetchPreview(
  ctx: { site?: string; docText?: string },
  specProvided: boolean,
): Promise<Preview | null> {
  try {
    const r = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctx, specProvided }),
    });
    return await r.json();
  } catch {
    return null; // server unreachable — card shows "preview unavailable"
  }
}

export interface Plan {
  file: string | null;
  content: string | null;
  awaitingProceed?: boolean;
}

export async function fetchPlan(): Promise<Plan> {
  const r = await fetch('/api/plan');
  if (!r.ok) return { file: null, content: null };
  return r.json();
}

export async function savePlan(content: string): Promise<boolean> {
  const r = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ content }),
  });
  return r.ok;
}

/**
 * Single data hook: /api/state is the source of truth (poll + refetch), the SSE
 * stream is the live trigger — every incoming signal debounces a refetch, so the
 * feed and the store views never drift apart or duplicate.
 */
export function useDashboardData(pollMs = 5000) {
  const [state, setState] = useState<State>(EMPTY_STATE);
  const [report, setReport] = useState<Report>({ signOff: null, metrics: null });
  const [connected, setConnected] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [s, rep] = await Promise.all([fetchState(), fetchReport()]);
        if (alive) { setState(s); setReport(rep); }
      } catch { /* server restarting between runs — keep last good state */ }
    };
    refresh();
    const timer = setInterval(refresh, pollMs);

    const es = new EventSource('/api/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as Signal | { type: 'ACTIVITY'; activity: ActivityEvent };
      if (msg.type === 'HELLO') { setConnected(true); return; }
      // Ephemeral per-iteration telemetry: update the strip/token tile directly —
      // no store refetch (nothing persistent changed on an activity heartbeat).
      if (msg.type === 'ACTIVITY') {
        const a = (msg as { activity: ActivityEvent }).activity;
        setState((s) => ({ ...s, activity: a, liveTokens: a.tokensRun }));
        return;
      }
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(refresh, 250);
    };

    return () => { alive = false; clearInterval(timer); es.close(); };
  }, [pollMs]);

  const refreshNow = async () => {
    try {
      const [s, rep] = await Promise.all([fetchState(), fetchReport()]);
      setState(s); setReport(rep);
    } catch { /* ignore */ }
  };

  return { state, report, connected, refreshNow };
}
