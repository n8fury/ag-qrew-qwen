import { useEffect, useRef, useState } from 'react';
import { EMPTY_STATE, type Report, type Signal, type State } from './types';

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

export const startRun = () => fetch('/api/run', { method: 'POST', headers: authHeaders() });
export const proceed = () => fetch('/api/proceed', { method: 'POST', headers: authHeaders() });

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
      const sig = JSON.parse(e.data) as Signal;
      if (sig.type === 'HELLO') { setConnected(true); return; }
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
