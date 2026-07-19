import type { RunContext } from './agents/worker.js';

/**
 * The bundled demo target as ONE canonical preset. The demo used to be
 * hardcoded twice (cli.ts + server.ts) with its app-specific oracles baked
 * into the task builders; generalizing runs (plan-general-inputs Phase A)
 * moves all of that here. Task builders are now target-agnostic — everything
 * demo-specific rides in ctx fields (docText, siteMap, appNotes,
 * priorityOracles) that any other target can supply for itself.
 */

export const DEMO_DOC = `Sprint 1 — Demo Task Manager
Release notes:
- Users can sign in with email + password (roles: admin, standard user).
- Authenticated users can list, create, update, and delete tasks.
- A task has a title (required, max 200 characters) and a done flag.
- Creating a task with a missing or over-length title must be rejected with a 400 error.
- The tasks page must always show the current list of tasks with an accurate count.
Entry points:
- The sign-in page is the root page (/). There is no separate /login route.
- The tasks page is served at /tasks.
- The REST API is rooted at /api (auth: POST /api/auth/login) — see the OpenAPI spec.`;

export const DEMO_SITE_MAP =
  'login UI = / (root page, email+password form) · tasks UI = /tasks · REST API under /api per the OpenAPI spec (auth: POST /api/auth/login)';

/** Verified app behaviour the script-writer must trust over stored cases. */
export const DEMO_APP_NOTES = [
  `A SUCCESSFUL login lands on /tasks. To assert a redirect, use waitForURL('**/tasks') OR check`,
  `page.url().includes('/tasks') — NEVER waitForURL('/tasks'): a bare path does not match the full`,
  `URL (e.g. http://host:3000/tasks) and will time out even though the navigation succeeded.`,
  `This app has NO forgot-password flow, NO field-level validation messages, and NO`,
  `password-strength rules — if a stored test case asserts such a feature or any specific error`,
  `text, that feature does NOT exist here: record the case BLOCKED with a short note ("feature`,
  `not present in app") instead of asserting invented UI text.`,
].join('\n');

/** Must-check API claims from the release notes (qa-api-tester runs these first). */
export const DEMO_API_ORACLES = [
  `("Creating a task with a missing or over-length title must be rejected with a 400 error"):`,
  `(1) POST /api/tasks with NO title (authed) — expect 400; READ THE BODY of whatever comes back;`,
  `(2) POST /api/tasks with a 201-character title (authed) — expect 400 per the spec's maxLength: 200;`,
  `(3) POST /api/tasks with no Authorization header — expect 401.`,
  `File a bug immediately for each mismatch, then continue the full battery.`,
].join('\n');

/** Must-check UI/exploratory oracles (qa-hawk runs these first). */
export const DEMO_EXPLORE_ORACLES = [
  `(1) browser_snapshot the tasks page and read its H2 heading VERBATIM from the vision transcript —`,
  `    the requirements demand an accurate task count in the header (e.g. "Tasks (3)"). If the heading`,
  `    shows anything that is not the true number — the wrong number, or a non-value like "undefined" —`,
  `    that is a bug: file it immediately, quoting the heading text exactly;`,
  `(2) DELETE staleness — run this exact sequence, do not skip the DELETE leg:`,
  `    a. POST /api/tasks to create a task (note its id), b. DELETE /api/tasks/{id} via the API,`,
  `    c. GET /api/tasks AND browser_snapshot /tasks — the requirements say the tasks page`,
  `    "must always show the current list of tasks"; if the page still shows the deleted task`,
  `    while the API list omits it, that is a bug (file it with both pieces of evidence).`,
  `    (Create-then-recheck alone is NOT enough — the delete leg is where refresh defects hide.`,
  `    Filing the count-header bug does NOT cover this oracle — they are two separate oracles.)`,
].join('\n');

/** The full demo RunContext, targeting `site` (defaults come from config.demoAppUrl). */
export function demoContext(site: string): RunContext {
  return {
    project: 'Demo Task Manager',
    sprint: 1,
    site,
    modules: ['auth', 'tasks'],
    creds: {
      adminEmail: 'admin@demo.test', adminPassword: 'admin123',
      userEmail: 'user@demo.test', userPassword: 'user123',
    },
    docText: DEMO_DOC,
    siteMap: DEMO_SITE_MAP,
    appNotes: DEMO_APP_NOTES,
    priorityOracles: { api: DEMO_API_ORACLES, explore: DEMO_EXPLORE_ORACLES },
  };
}
