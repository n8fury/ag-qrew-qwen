# Planted Bugs — ag-qrew Demo Task Manager

This app is an intentionally buggy target-under-test for the multi-agent QA
pipeline. There are **exactly 4** planted bugs. The OpenAPI spec
(`openapi.yaml`) documents the *correct* behaviour; every bug below is a
deviation from that spec.

Base URL: `http://localhost:3000`
Login for a token: `admin@demo.test` / `admin123`

| Bug # | Module | Type | Endpoint / Page | Reproduce | Expected | Actual | Caught by |
|-------|--------|------|-----------------|-----------|----------|--------|-----------|
| 1 | tasks | UI | `GET /tasks` (HTML) | Open the tasks page in a browser and read the heading | Heading shows real count, e.g. `Tasks (3)` | Heading literally renders `Tasks (undefined)` — the template value was never populated | qa-hawk (vision) |
| 2 | tasks | boundary | `POST /api/tasks` | Send a task with a 201-character `title` (auth required) | `400` — title exceeds documented `maxLength: 200` | `201 Created` — over-length title accepted and stored | qa-api-tester |
| 3 | tasks | contract (200-on-error) | `POST /api/tasks` | Send body with missing/empty `title` (auth required) | `400 {"error":"title is required"}`, no task created | **`200`** with body `{"error":"title is required"}` — status and body contradict; no task created | qa-api-tester |
| 4 | tasks | data-refresh (UI vs API) | `DELETE /api/tasks/:id` then `GET /tasks` (HTML) vs `GET /api/tasks` (API) | Create a task, DELETE it, then load `GET /tasks` HTML and call `GET /api/tasks` | Deleted task absent everywhere | API list correctly omits it, but the HTML page still shows it (stale `renderedTasks` snapshot is refreshed on CREATE, never on DELETE) | qa-hawk (vision) — see DISPUTE below |

## Bug details

### Bug #1 — `Tasks (undefined)` heading (UI)
`GET /tasks` renders `<h2>Tasks (${count})</h2>` where `count` is declared but
never assigned, so the string literally contains the word `undefined`. A vision
model screenshotting the page can read "undefined" in the heading.
Location: `server.js`, `GET /tasks` handler.

### Bug #2 — max title length not enforced (boundary)
`POST /api/tasks` has no length validation. The spec documents `maxLength: 200`
and that over-length titles must return `400`. A 201-char title returns `201`.
Location: `server.js`, `POST /api/tasks` — the length check is deliberately absent.

### Bug #3 — 200-on-error for missing title (contract) — the marquee bug
`POST /api/tasks` with a missing/empty title returns **HTTP 200** while the body
says `{"error":"title is required"}`. The status line (success) contradicts the
body (error). No task is created. An agent that only checks status codes would
call this a pass; qa-api-tester reads the body and flags the contradiction.
Location: `server.js`, `POST /api/tasks` — `res.status(200)` on the missing-title branch (should be 400).

### Bug #4 — deleted task still visible on HTML page (data-refresh) — expected DISPUTE
There are two data sources:
- `tasks` — the canonical array. All API endpoints read/write this correctly.
- `renderedTasks` — a snapshot used ONLY by the `GET /tasks` HTML page. It is
  refreshed (`renderedTasks = [...tasks]`) on `POST /api/tasks` (create) but is
  **never** refreshed on `DELETE`.

Result after deleting a task:
- `GET /api/tasks` (API) correctly OMITS the deleted task, and `DELETE` returns `200 {deleted:true}`.
- `GET /tasks` (HTML) STILL shows the deleted task (renders the stale snapshot).

**Expected DISPUTE and resolution:**
- **qa-hawk (vision)** files: "deleted task still shows on the /tasks page" — looks like a data-integrity / delete-not-working defect.
- **qa-api-tester** counters: `DELETE /api/tasks/:id` returns `200` and `GET /api/tasks` correctly omits the item — the API is behaving correctly.
- **QA Lead** reconciles the two reports and **RECLASSIFIES** this as a **UI-refresh bug** (the HTML page renders a stale snapshot), not a data-integrity bug. The delete works; the page just fails to re-read the source of truth.
Location: `server.js` — `renderedTasks` updated on POST, intentionally not on DELETE.
