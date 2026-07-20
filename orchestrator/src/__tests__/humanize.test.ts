import { describe, expect, it } from 'vitest';
import { humanizeHint } from '../humanize.js';

describe('humanizeHint (activity-strip tool hints, Phase F.4)', () => {
  it.each([
    ['tc_store auth', 'writing test cases for auth'],
    ['tc_store', 'writing test cases'],
    ['tc_list tasks', 'reading test cases for tasks'],
    ['playwright_run specs/login.spec.ts', 'running E2E spec specs/login.spec.ts'],
    ['playwright_run', 'running E2E spec'],
    ['browser_snapshot http://localhost:3000/tasks', 'inspecting http://localhost:3000/tasks (vision)'],
    ['browser_snapshot', 'inspecting page (vision)'],
    ['http_request GET /api/tasks', 'probing API GET /api/tasks'],
    ['bug_file Tasks header shows undefined', 'filing a bug'],
    ['raise_dispute', 'raising a dispute'],
    ['fs_write qa/test-plan-sprint1.txt', 'writing artefact qa/test-plan-sprint1.txt'],
    ['fs_write', 'writing artefact'],
    ['fs_read test-plan-sprint1.txt', 'reading test-plan-sprint1.txt'],
    ['result_record PASS', 'recording results'],
    ['bus_write DONE', 'signalling the bus'],
    ['bus_read', 'reading the bus'],
  ])('%s → %s', (hint, expected) => {
    expect(humanizeHint(hint)).toBe(expected);
  });

  it('passes unknown tools through untouched', () => {
    expect(humanizeHint('mystery_tool xyz')).toBe('mystery_tool xyz');
  });
});
