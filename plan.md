# AG-QREW Improvement Plan

Scope: implement every finding from the 2026-07-19 codebase audit, plus the dashboard
run-progress UX rework (segmented phase progress bar replacing the pulsing "running" dot).

Decisions locked in:
- **Progress source**: server-authoritative — orchestrator emits `PHASE` signals; `/api/state` exposes `{index, total, label}`.
- **Test runner**: vitest.
- **Server protection**: loopback bind by default + optional `AGQREW_TOKEN` header on mutating routes.
- **Rebuttal**: enriched prompts (full bug row incl. steps + evidence), no extra agent runs.

Ordering rationale: tests + CI land first so every later fix ships with a regression test;
the dashboard phase-bar work comes after the server changes it depends on.

---

## Phase 1 — Test harness + CI

- [x] Task 1.1: Add vitest to `orchestrator/` devDependencies with `test` and `test:watch` npm scripts; create `orchestrator/src/__tests__/` with one smoke test to prove wiring.
  - Verification: `cd orchestrator && npm test` runs vitest and reports ≥1 passing test.

- [x] Task 1.2: Unit tests for the JSON-repair pipeline in `agentLoop.ts` — `parseToolArgs` (valid JSON, markdown fences, trailing commas, raw newlines in strings, truncated payload, unrepairable garbage) and `closeUnterminated`. Export any private helper needed for testing.
  - Verification: `npm test -- parse` passes; suite includes a case proving a payload cut mid-string parses after repair and a garbage case returning `null`.

- [x] Task 1.3: Unit tests for `Bus`: `Bus.parse` round-trip (`write` → `parse` yields equal signal), session filtering in `readAll`, `allDone`, `blockers`, and rejection of malformed lines.
  - Verification: `npm test -- bus` passes; includes a test where two sessions interleave in one file and `readAll` returns only the current session's lines.

- [x] Task 1.4: Unit tests for the spec guard in `tools/store.ts`: `parseSpecPaths` against the real `demo-app/openapi.yaml`, `pathMatches` with `{param}` wildcards, and `undocumentedEndpointCited` (documented pair accepted, fabricated `GET /api/users` rejected, numeric-id normalisation). Export these helpers.
  - Verification: `npm test -- store` passes; includes a rejection test citing an endpoint absent from the spec.

- [x] Task 1.5: Unit tests for verdict logic in `agents/qaLead.ts`: `computeVerdict` matrix (Critical→FAIL, >2 High→FAIL, 1 High→CONDITIONAL PASS, open dispute→FAIL, BLOCKED signal→FAIL, clean→PASS) and REJECTED-dispute bug exclusion via `effectiveBugs` (export it or test through `computeVerdict`).
  - Verification: `npm test -- verdict` passes with all six verdict branches covered.

- [x] Task 1.6: Unit tests for sandboxing: `resolveSandboxed` (`tools/fs.ts`, export it) and `assertInsideQa` (`tools/playwright.ts`) — accepts `qa/`-prefixed and bare relative paths, rejects `../` escapes and absolute paths outside the root.
  - Verification: `npm test -- sandbox` passes; includes `..\\..\\etc` and absolute-path escape cases that throw.

- [x] Task 1.7: Mock-mode E2E test: run the full society pipeline with `AGQREW_MOCK=1` (reusing `mock/runMock.ts` machinery) against a temp qa dir; assert a verdict is produced, `metrics.json` is written, and the bus contains `DONE` signals.
  - Verification: `npm test -- e2e` passes with no `DASHSCOPE_API_KEY` set in the environment.

- [x] Task 1.8: GitHub Actions workflow `.github/workflows/ci.yml`: on push/PR run (a) orchestrator `npm ci && npm run typecheck && npm test`, (b) dashboard `npm ci && npm run build`.
  - Verification: workflow file exists, `act`-style dry inspection or a pushed branch shows all jobs green in the Actions tab.

## Phase 2 — Logic-bug fixes (each with a regression test from Phase 1's harness)

- [x] Task 2.1: Fix the loop-guard escalation ordering in `agentLoop.ts` so bad-JSON repeats also reach the hard "result WITHHELD" stop at ≥5 identical attempts (currently the `!parsed && repeats >= 3` branch shadows it forever).
  - Verification: new unit test drives the guard logic (extracted into a testable function) with 5 identical unparseable payloads and asserts the withheld/hard-stop message appears; `npm test` passes.

- [x] Task 2.2: Enable `PRAGMA foreign_keys = ON` in `db.ts` so `results.case_id` and `disputes.bug_id` FKs are enforced.
  - Verification: unit test asserts `recordResult({ case_id: 9999, … })` throws a FOREIGN KEY constraint error on a fresh DB, and the mock E2E (Task 1.7) still passes.

- [x] Task 2.3: Generalise `escapeControlCharsInStrings` to escape all raw control chars `< 0x20` inside JSON strings (as `\uXXXX`), not just `\n` `\r` `\t`.
  - Verification: unit test feeds a string containing `\x08` and `\x0c` inside a JSON string literal and `parseToolArgs` returns parsed args.

- [x] Task 2.4: Validate numeric config in `config.ts` — `AGENT_MAX_ITERATIONS`, `AGENT_MAX_TOKENS`, `PORT` must be finite positive numbers; throw at startup otherwise (a `NaN` budget currently disables the token guard silently).
  - Verification: unit test asserts a helper `reqNumber('X', …)` throws on `"150k"` and returns 150000 on `"150000"`; `npm run typecheck` passes.

## Phase 3 — Server security

- [x] Task 3.1: Add a zod schema for `RunContext` and validate `req.body.ctx` in `POST /api/run` (`server.ts`); reject invalid shapes with 400 and require `site` to be an `http(s)` URL. This makes the declared-but-unused `zod` dependency real.
  - Verification: unit test validates a good ctx and rejects `{ site: "file:///etc/passwd" }` and `{ site: "http://169.254.169.254" }` (per Task 4.1's policy); grep shows `zod` imported in `src/`.

- [x] Task 3.2: Optional token auth: if `AGQREW_TOKEN` is set, all mutating routes (`POST /api/run`, `/api/proceed`, `/api/plan`) require `Authorization: Bearer <token>` (or `X-AGQREW-TOKEN`); 401 otherwise. No-op when unset. Dashboard passes the token from a query param / localStorage if present.
  - Verification: unit test on the middleware: request without token → 401 when env set, → 200 path when env unset; mock E2E unaffected.

- [x] Task 3.3: Bind the orchestrator port to loopback by default in `docker-compose.yml` (`127.0.0.1:8787:8787`) with a commented override for remote demos (public bind + `AGQREW_TOKEN`); document both in README's run section.
  - Verification: `docker compose config` shows the loopback binding; README documents the remote-demo override.

## Phase 4 — Tool-layer hardening

- [ ] Task 4.1: URL policy for `http_request` (`tools/http.ts`): allow only the configured target host (from `RunContext.site` / `DEMO_APP_URL`) plus an `HTTP_ALLOW_HOSTS` env escape hatch; always deny link-local/metadata ranges (169.254.0.0/16, `metadata.google.internal`). Return a policy-explaining tool error, never throw.
  - Verification: unit tests — target-host URL allowed, `http://169.254.169.254/latest/meta-data` and an off-target host rejected with the policy message.

- [ ] Task 4.2: Restrict sandbox path characters in `resolveSandboxed` / `assertInsideQa` to `[A-Za-z0-9._/\\-]` (rejects `&`, `;`, spaces, quotes), closing the Windows `shell: true` injection vector in `playwright_run`.
  - Verification: unit tests — `specs/login.spec.ts` accepted; `x&calc.spec.ts` and `a b.spec.ts` rejected with a clear error.

- [ ] Task 4.3: Cap `browser_snapshot` screenshot size (`tools/playwright.ts`): clip full-page captures to a max height (e.g. 4000px) and skip the vision call with a descriptive tool error if the encoded PNG exceeds ~5 MB.
  - Verification: code review of the clip/cap constants + unit test for the size-gate helper; mock E2E still passes.

- [ ] Task 4.4: Fix retry classification in `qwen.ts`: retry only true connection errors (`OpenAI.APIConnectionError` / known transient codes) and 429/5xx — not any error with `status === undefined`; log non-retriable errors once and fail fast (403 model-access denials already fail fast; keep it that way).
  - Verification: unit test with an injected fake client — a `TypeError` surfaces immediately (1 attempt), a 429 retries with backoff, a 500 retries, a 400 fails fast.

## Phase 5 — Adjudication rebuttal upgrade

- [ ] Task 5.1: Refactor `adjudicate.ts` prompt construction into exported pure builders (`buildRebuttalPrompt`, `buildJudgePrompt`) and enrich both with the full bug row — including `steps` and `evidence`, which the judge currently never sees.
  - Verification: unit tests assert both prompts contain the bug's steps and evidence text when present, and degrade gracefully (`(bug row not found)`) when absent.

- [ ] Task 5.2: Add `parseVerdict` unit tests (fenced JSON, prose-wrapped JSON, invalid verdict → UPHELD default with fallback rationale) — locking in the current lenient behaviour before/after the refactor.
  - Verification: `npm test -- adjudicate` passes with ≥4 parse cases.

## Phase 6 — Dashboard run-progress UX (progress bar replaces the pulsing dot)

Pipeline segments (fixed, 9): Env gate → Test plan → Approval → Test cases → Scripts → Explore → API tests → Adjudicate → Sign-off. (The conditional 2d cross-check folds into the API segment.)

- [ ] Task 6.1: Add a `PHASE` signal type to the bus grammar (`bus.ts` union + `docs/signals.md`), payload `"<index>/<total>|<id>|<label>"`; emit it in `agents/qaLead.ts` at each phase transition, including one while paused at the approval checkpoint and a terminal one on finalize.
  - Verification: mock E2E asserts the bus contains PHASE signals with strictly increasing indexes ending at `9/9`; `docs/signals.md` documents the type.

- [ ] Task 6.2: Surface phase in the API: `/api/state` gains `phase: { index, total, id, label } | null`, derived from the live session's latest `PHASE` signal (and from the last-session fallback in `signalsForDashboard`, so a finished run still shows a full bar after server restart).
  - Verification: unit test on the phase-derivation helper given a signal list; `curl /api/state` during a mock run shows the field.

- [ ] Task 6.3: Dashboard `ProgressBar` component: replace the `status-pill` dot in `App.tsx` with a 9-segment bar — completed segments solid, current segment with a subtle sweep animation (no pulsing dot), the Approval segment amber + "awaiting your approval" when `awaitingProceed`, all-solid + verdict tint when finished, empty + "idle" label when no run. Keep phase label + `k/9` text beside the bar; respect `prefers-reduced-motion`.
  - Verification: `cd dashboard && npm run build` passes; manual check against a mock run shows the bar advancing through segments and the amber approval state at the checkpoint.

- [ ] Task 6.4: Update the inline `MINI_DASHBOARD` fallback in `server.ts` to show the same phase text (simple `k/9 · label` line — no need for the full bar), and rebuild + commit `dashboard/dist`.
  - Verification: with `dashboard/dist` renamed away, `GET /` shows the phase line during a mock run; restored `dist` serves the new bar; `git status` shows the fresh `dist` committed.

## Phase 7 — Cleanups

- [ ] Task 7.1: SSE keepalive — server sends a `: ping` comment every 25 s to each connected client (`server.ts`); dashboard's `EventSource` unaffected.
  - Verification: `curl -N localhost:8787/api/stream` shows ping comments arriving while idle.

- [ ] Task 7.2: Incremental bus reads — `Bus` caches parsed signals with a byte offset and only parses appended data on subsequent `readAll` calls (drop-in, same return shape).
  - Verification: existing bus unit tests still pass; new test appends after a read and sees both old and new signals; a test writes 10k lines and asserts a second `readAll` is served from cache (no full re-parse — assert via a parse-count hook or timing-free counter).

- [ ] Task 7.3: Tidy local run archives: move `orchestrator/qa-*`/`*.log` clutter under `orchestrator/archives/` (untracked), update `.gitignore` patterns accordingly.
  - Verification: `git status` stays clean; `ls orchestrator` no longer lists `qa-attempt*` / `run*.log` at top level.

- [ ] Task 7.4: README refresh — document the token/loopback options, the PHASE signal, the progress bar, and the `npm test` / CI story.
  - Verification: README sections exist and match the implemented behaviour (spot-check commands copy-paste clean).
