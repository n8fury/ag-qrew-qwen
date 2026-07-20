/**
 * Humanize AgentLoop call hints ("tc_store auth", "http_request GET /api/tasks")
 * into dashboard activity-strip wording (plan-general-inputs F.4). ONE shared
 * map: it lives in the orchestrator tree so the vitest suite covers it, and the
 * dashboard imports it cross-package (pure TS — no node or DOM dependencies).
 */
export function humanizeHint(hint: string): string {
  const [tool, ...rest] = hint.trim().split(/\s+/);
  const arg = rest.join(' ');
  switch (tool) {
    case 'tc_store': return arg ? `writing test cases for ${arg}` : 'writing test cases';
    case 'tc_list': return arg ? `reading test cases for ${arg}` : 'reading test cases';
    case 'playwright_run': return arg ? `running E2E spec ${arg}` : 'running E2E spec';
    case 'browser_snapshot': return arg ? `inspecting ${arg} (vision)` : 'inspecting page (vision)';
    case 'http_request': return arg ? `probing API ${arg}` : 'probing API';
    case 'bug_file': return 'filing a bug';
    case 'raise_dispute': return 'raising a dispute';
    case 'fs_write': return arg ? `writing artefact ${arg}` : 'writing artefact';
    case 'fs_read': return arg ? `reading ${arg}` : 'reading artefact';
    case 'result_record': return 'recording results';
    case 'bus_write': return 'signalling the bus';
    case 'bus_read': return 'reading the bus';
    default: return hint; // unknown tool — show the raw hint rather than hide it
  }
}
