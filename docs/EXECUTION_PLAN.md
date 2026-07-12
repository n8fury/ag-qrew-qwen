# EXECUTION PLAN — AG-QREW on Qwen

> Work top to bottom. Each task lists the files to create and a **Done when** check.
> Full spec: `docs/AG-QREW-QWEN-PLAN.pdf`. Live state: `docs/HANDOFF.md`.
> Today is Day 2 (July 6). Fable ends July 7 — all code generation must land by then.

---

## 0. BLOCKER — do this first (human, ~30 min, can lag days)
- [ ] Activate Alibaba Cloud **Model Studio**, get `DASHSCOPE_API_KEY`, submit the credit coupon.
- [ ] Copy `.env.example` → `.env`, paste the key, confirm region + exact model names.
- [ ] **Smoke test** (de-risks the whole runtime): one chat call AND one tool-call round-trip.
      `cd orchestrator && npx tsx src/smoke.ts` (task 1 creates this).
- **Done when:** the smoke test prints a Qwen reply and a parsed tool call.

## DONE (foundation + Track-3 conflict resolution)
- [x] `orchestrator/` scaffold — package.json, tsconfig; `npm install` + `tsc --noEmit` pass.
- [x] `src/config.ts`, `src/qwen.ts` (DashScope client, retries), `src/bus.ts` (signal bus),
      `src/db.ts` (SQLite), `src/agentLoop.ts` (the reusable loop).
- [x] Adjudication: `src/adjudicate.ts`, `src/tools/dispute.ts`, `disputes` table, DISPUTE/RESOLVED signals.

---

## CRITICAL PATH — the runnable pipeline (do 1→6 in order)

### 1. Tool layer  (`orchestrator/src/tools/*.ts` + `tools/index.ts`)
One typed fn + JSON schema per tool, following the `dispute.ts` pattern.
- [ ] `bus.ts` tools: bus_write, bus_read
- [ ] `store.ts` tools: tc_store, tc_list, bug_file, result_record  (wrap `db.ts`)
- [ ] `fs.ts` tools: fs_write, fs_read  — **sandboxed to `qa/` only**
- [ ] `http.ts` tool: http_request  (for qa-api-tester)
- [ ] `playwright.ts` tools: playwright_run(specPath), browser_snapshot(url) (screenshot → qwen-vl)
- [ ] `smoke.ts` (task 0's test): one plain chat + one forced tool call
- **Done when:** each tool has a schema, `tools/index.ts` exports registries per agent, typecheck passes.

### 2. Port + trim the 5 prompts  (`orchestrator/prompts/*.md`)  ✅ DONE
Copy from `commands/`, strip Claude Code tool refs, keep SFDIPOT / FEW HICCUPPS.
- [x] qa-lead, qa-tc-writer, qa-api-tester, qa-script-writer, qa-hawk — all 5 ported.
- **Done:** each prompt's frontmatter `tools:` matches its `toolsFor()` registry in
  `src/tools/index.ts`; no Claude/MCP/TestRail/Jira verbs (only intentional "there is
  no X" disclaimers). Two real adaptations: qa-script-writer targets Playwright-as-a-library
  standalone `tsx` scripts (no `@playwright/test`) and explores via a probe script run through
  `playwright_run` (it has no `browser_snapshot`); qa-hawk recasts SFDIPOT/FEW HICCUPPS onto
  `browser_snapshot` (qwen-vl) + `http_request` (no interactive click-driving, no TestRail).

### 3. Orchestrator — QA Lead  (`orchestrator/src/agents/qaLead.ts`)  ✅ DONE
- [x] `runSociety(ctx, opts)` drives Phase 0 (qa-hawk env gate → halt on BLOCKED HAWK-ENV),
      Phase 1 (qa-lead Mode 1 test plan), the **`proceed` checkpoint** (auto / stdin / web callback),
      Phase 2 (workers in two dependency-ordered `Promise.all` groups — see note),
      Phase 3 (**drain `db.openDisputes()` → `adjudicate()` each**),
      Phase 4 (qa-lead Mode 2 sign-off + deterministic verdict).
- **Note:** AgentLoop is a synchronous request/response loop with no background-wait
      primitive, so Phase 2 runs group A (tc-writer + api-tester) then group B
      (script-writer + hawk) — B consumes A's cases via `tc_list`. This honours the
      TC-READY→consume dependency deterministically instead of racing one big `Promise.all`.
- Added along the way: `META` signal type (bus.ts + tools/bus.ts), per-agent budget caps
      on `AgentConfig` (`maxIterations`/`maxTokens`), `src/agents/worker.ts` (prompt loader +
      AgentLoop factory + task-string builders). Typecheck clean.

### 4. Two simplest workers  (`orchestrator/src/agents/`)  ✅ DONE (as factory, not per-file classes)
- [x] Workers are the SAME `AgentLoop` engine differing only in (prompt, model, tools).
      Rather than four near-identical files, `worker.ts` loads each ported prompt and builds
      its loop; the orchestrator's run ORDER encodes the pipeline. qa-tc-writer (tc_store →
      TC-READY → DONE) and qa-api-tester (http_request per endpoint → result_record + bug_file)
      both run as `AgentLoop` instances and populate the DB.
- **Done when:** ✅ both instantiate + are wired into `runSociety` Phase 2a. (Runtime-verified
      pending the API key.)

### 5. demo-app  (`demo-app/`)  ✅ DONE
- [x] Express task-manager: login (admin/user) + task CRUD + REST API + `openapi.yaml` + HTML pages.
- [x] `PLANTED_BUGS.md` with **exactly 4 bugs**: #1 UI (`Tasks (undefined)` header), #2 boundary
      (title >200 chars accepted), #3 API 200-on-error (`POST /api/tasks` missing title → 200 + error body),
      #4 data-refresh (DELETE ok in API but stale in HTML → drives the qa-hawk vs qa-api-tester dispute).
- **Done when:** ✅ app runs on :3000, OpenAPI valid, 4 bugs reproduced via curl (verified).

### 6. Remaining two workers  ✅ DONE (via the same factory)
- [x] qa-script-writer (Playwright-as-a-library specs via `playwright_run`, coverage matrix, CI yaml)
      and qa-hawk (smoke + SFDIPOT explore, `browser_snapshot` → qwen-vl, bug_file + raise_dispute)
      run as `AgentLoop` instances in Phase 2b.
- **Done when:** ⏳ pipeline finds 4/4 planted bugs + ≥1 adjudicated dispute — **live-run check pending
      the API key**. The demo-app is engineered so bug #4 forces exactly that dispute.
- **Offline proof (done):** `npm run demo:mock` (AGQREW_MOCK=1) runs the whole society on a mock model
      and self-checks 8 invariants green — dispute raised → **rebuttal** → judge RECLASSIFIES →
      CONDITIONAL PASS. Also added a one-round rebuttal to `adjudicate.ts` and reordered Phase 2 so the
      disputing agent runs after the one it challenges.

---

## PROOF + SHELL (7→9)

### 7. Single-agent baseline  (`orchestrator/src/baseline/singleAgent.ts`)  ✅ DONE
- [x] One monolithic `AgentLoop` with `allTools`, bigger iteration budget. Both modes write
      `qa/metrics.json` (keyed `society`/`single`: wall-clock, tokens, bugs, cases, results, verdict).
      The solo structurally raises 0 disputes — that absence is itself the Track-3 finding.
- **Done when:** ✅ `--mode single` and `--mode society` both wired to emit metrics (runtime pending key).

### 8. Server + CLI  (`orchestrator/src/server.ts`, `src/cli.ts`)  ✅ DONE
- [x] `cli.ts --mode society|single` (+ `--interactive`, `--no-gate`, `--site`, `--spec`; defaults to demo-app).
- [x] `server.ts` — Express + SSE bus stream, JSON state endpoints, `POST /api/run`, `POST /api/proceed`.

### 9. Dashboard  (`dashboard/`, Vite + React)  ⏳ PARTIAL  [owner: n8fury]
- [x] Minimal **inline dashboard** served at `/` (no build step): live signal feed, bug/dispute list,
      Start + Proceed buttons via SSE. `server.ts` serves `dashboard/dist` instead if a real build exists.
- [ ] Full React app (TC browser, coverage matrix, richer sign-off view) still to build.

---

## DEPLOY + SUBMIT (Days 4–5, Opus/Sonnet)
- [ ] `docker-compose.yml` (orchestrator + demo-app + shared `qa/` volume); test Docker locally Day 3.
- [ ] `docs/ecs-setup.md` + `deploy.sh`; run full pipeline on Alibaba Cloud ECS; record deployment proof.
- [ ] Docs: `docs/architecture.md` + Mermaid→PNG, `signals.md`, `scope-decisions.md`, README rewrite.
- [ ] 3-min demo video (script + shot list); make repo public; MIT LICENSE via GitHub UI; submit on Devpost (Track 3).

---

## If time collapses (priority order, from plan §12)
working pipeline on cloud > video > README > baseline metrics > dashboard polish > stretch.
A deployed system with a clear video beats a feature-complete repo stuck on localhost.

## Owner split (plan §9)
- n8fury: orchestrator runtime, qwen client, tools, baseline, dashboard, deploy + proof
- foyezkabir: agent prompt adaptation, demo-app + planted bugs, video
- shared: README / docs / Devpost text
