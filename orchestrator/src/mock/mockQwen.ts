import type { ChatArgs, ChatResult } from '../qwen.js';

/**
 * Offline mock of the Qwen chat endpoint (AGQREW_MOCK=1). It ignores the real
 * prompts and returns a SCRIPTED sequence of tool calls per agent, so the whole
 * society → bug → dispute → rebuttal → adjudication → verdict → metrics path runs
 * deterministically with no API key. It proves the plumbing; it does not exercise
 * model reasoning (that needs a real key). The scripts touch only LOCAL tools
 * (store / bug / result / dispute / bus / fs) so the run is fully offline.
 */

let callId = 0;
const toolCall = (name: string, args: unknown): ChatResult => ({
  message: {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: `mock_${++callId}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  } as any,
  usageTokens: 60,
});
const finalText = (text: string): ChatResult => ({ message: { role: 'assistant', content: text } as any, usageTokens: 40 });

// ── canned artefacts ────────────────────────────────────────────────────────
const AUTH_CASE = {
  tc_ref: 'TC-001', title: 'Verify that valid admin login succeeds', section: 'Functional — Positive',
  type: 'Functional', priority: 'High', preconditions: '- app running\n- valid admin account',
  steps: '1. POST /api/auth/login with valid admin creds', test_data: 'email: admin@demo.test\npassword: admin123',
  expected: '- 200 with a token and role',
};
const TASKS_CASE = {
  tc_ref: 'TC-001', title: 'Verify that creating a task with a missing title is rejected',
  section: 'Functional — Negative / Boundary', type: 'Negative', priority: 'High',
  preconditions: '- authenticated', steps: '1. POST /api/tasks with an empty body', test_data: '{}',
  expected: '- 400 with a validation error',
};
const DELETED_BUG = {
  title: 'Tasks: deleted task still appears in the list after deletion', severity: 'High', module: 'tasks',
  oracle: 'History — UI diverges from data after a delete', steps: '1. create a task\n2. delete it\n3. reload /tasks',
  expected: 'the deleted task no longer appears', actual: 'the deleted task is still listed',
  evidence: 'qa/screenshots/tasks-after-delete.png',
};
const UI_BUG = {
  title: 'Tasks: header shows "Tasks (undefined)" instead of a count', severity: 'Low', module: 'tasks',
  oracle: 'Image — unrendered template value', steps: '1. open /tasks',
  expected: 'header shows the real count, e.g. "Tasks (3)"', actual: 'header shows "Tasks (undefined)"',
  evidence: 'qa/screenshots/tasks.png',
};
const CONTRACT_BUG = {
  title: 'POST /api/tasks returns HTTP 200 with an error body when title is missing', severity: 'High', module: 'tasks',
  oracle: 'Standards — a 200 status carrying an error body', steps: '1. POST /api/tasks with {} and a valid token',
  expected: '400 with a validation error', actual: '200 with {"error":"title is required"} and no task created',
  evidence: 'HTTP 200 {"error":"title is required"}',
};
const DISPUTE = {
  bugId: 1, raisedBy: 'qa-hawk',
  claim: 'A deleted task still shows in the list, so deletion does not persist.',
  counterClaim: 'DELETE /api/tasks/1 returns 200 and GET /api/tasks omits the item — the API state is correct. This is a UI-refresh defect (stale render), not a data-integrity bug.',
};
const PLAN_TEXT = `TEST PLAN\n=========\nProject: Demo Task Manager\nSprint: 1\nSprint Risk Score: 5/10 — MEDIUM\n\n2. SCOPE\n- auth (login)  P1 H\n- tasks (CRUD)  P1 H\n\n6. FEATURE ANALYSIS\n--- Feature: tasks ---\nSFDIPOT: Function (create/delete), Data (title max 200), Structure (list + count).\nOracles: Claims, Standards, History.\nMUST work: create with valid title → 201; list shows accurate count.\nMUST handle: missing/over-length title → 400; deleted task disappears from the list.\n`;
const SIGNOFF_TEXT = `QA SIGN-OFF REPORT\n==================\nProject: Demo Task Manager\nSprint: 1\nVerdict: CONDITIONAL PASS\n\nBugs (post-adjudication): 3 — 1 High open (contract 200-on-error), 1 reclassified (UI refresh), 1 Low (undefined header).\nDisputes: 1, all RESOLVED (RECLASSIFIED).\nRationale: no open Critical; one High contract bug needs a fix before release.\n`;

// ── discriminator ─────────────────────────────────────────────────────────────
function identify(args: ChatArgs): { agent: string; variant?: string } {
  const sys = String(args.messages.find((m) => m.role === 'system')?.content ?? '');
  const user = String(args.messages.find((m) => m.role === 'user')?.content ?? '');
  if (sys.includes('adjudicating a disagreement')) return { agent: 'judge' };
  if (sys.includes('filed a QA finding')) return { agent: 'rebuttal' };
  if (sys.includes('# qa-tc-writer')) return { agent: 'qa-tc-writer' };
  if (sys.includes('# qa-api-tester')) return { agent: 'qa-api-tester' };
  if (sys.includes('# qa-script-writer')) return { agent: 'qa-script-writer' };
  if (sys.includes('# qa-hawk')) return { agent: 'qa-hawk', variant: user.includes('mode: environment') ? 'env' : 'explore' };
  if (sys.includes('# qa-lead')) return { agent: 'qa-lead', variant: user.includes('sign-off') ? 'signoff' : 'plan' };
  return { agent: 'unknown' };
}

type Step = () => ChatResult;

function scriptFor(agent: string, variant?: string): Step[] {
  switch (agent) {
    case 'qa-tc-writer':
      return [
        () => toolCall('tc_store', { module: 'auth', cases: [AUTH_CASE] }),
        () => toolCall('tc_store', { module: 'tasks', cases: [TASKS_CASE] }),
        () => finalText('Stored test cases for auth and tasks.'),
      ];
    case 'qa-script-writer':
      return [
        () => toolCall('result_record', { case_id: 1, status: 'PASS', note: 'login spec passed' }),
        () => finalText('Specs generated and run; login passes.'),
      ];
    case 'qa-hawk':
      return variant === 'env'
        ? [
            () => toolCall('bus_write', { type: 'HAWK-ENV', payload: 'READY | qa/reports/hawk-env-sprint1.txt' }),
            () => finalText('Environment validated — READY.'),
          ]
        : [
            () => toolCall('bug_file', DELETED_BUG),   // → bug #1 (disputed later)
            () => toolCall('bug_file', UI_BUG),        // → bug #2
            () => toolCall('result_record', { case_id: 2, status: 'FAIL', note: 'deleted task still visible' }),
            () => finalText('Explore complete — 2 UI defects filed.'),
          ];
    case 'qa-api-tester':
      return [
        () => toolCall('bug_file', CONTRACT_BUG),      // → bug #3
        () => toolCall('result_record', { case_id: 2, status: 'FAIL', note: '200 on missing-title' }),
        () => toolCall('raise_dispute', DISPUTE),      // disputes bug #1 (qa-hawk's)
        () => finalText('API tested — 1 contract bug filed, 1 dispute raised.'),
      ];
    case 'qa-lead':
      return variant === 'signoff'
        ? [() => toolCall('fs_write', { path: 'sign-off-report.txt', content: SIGNOFF_TEXT }), () => finalText('Sign-off written. Verdict: CONDITIONAL PASS.')]
        : [() => toolCall('fs_write', { path: 'test-plan-sprint1.txt', content: PLAN_TEXT }), () => finalText('Test plan written.')];
    default:
      return [() => finalText('(mock: no script for this agent)')];
  }
}

export function mockChat(args: ChatArgs): Promise<ChatResult> {
  const { agent, variant } = identify(args);

  if (agent === 'judge') {
    return Promise.resolve(finalText(JSON.stringify({
      verdict: 'RECLASSIFIED',
      rationale: 'The API DELETE returns 200 and GET /api/tasks omits the item, so the data layer is correct. The defect is a stale UI render, not data loss — reclassified as a UI-refresh bug and downgraded.',
      newSeverity: 'Medium',
      newTitle: 'Tasks: UI does not refresh after delete (stale list render)',
    })));
  }
  if (agent === 'rebuttal') {
    return Promise.resolve(finalText('Conceded — the API DELETE returns 200 and the list omits the item, so the data layer is correct. The real defect is that the /tasks page renders a stale snapshot; treat it as a UI-refresh bug.'));
  }

  const script = scriptFor(agent, variant);
  const assistantTurns = args.messages.filter((m) => m.role === 'assistant').length;
  const step = script[assistantTurns] ?? (() => finalText('Done.'));
  return Promise.resolve(step());
}
