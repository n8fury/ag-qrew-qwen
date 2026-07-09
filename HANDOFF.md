# HANDOFF — AG-QREW on Qwen

> The contract for any later session (Opus/Sonnet after July 7). Bootstrap with two reads:
> this file + `AG-QREW-QWEN-PLAN_0610.pdf`. Keep it updated.

## Current state (2026-07-06, Day 2)

**Day-1 foundation: DONE and typechecks clean** (`npm install` + `tsc --noEmit` both pass on Node 25 / Apple M4).

Built in `orchestrator/`:
- `package.json`, `tsconfig.json` — Node 20+ ESM + tsx, deps: openai, better-sqlite3, express, playwright, zod.
- `src/config.ts` — typed env loader; fails fast if `DASHSCOPE_API_KEY` is missing.
- `src/qwen.ts` — DashScope (Model Studio) client via the OpenAI-compatible SDK; retry+backoff on 429/5xx; **this is the "Alibaba Cloud API usage" file to link in the README per the rules.**
- `src/bus.ts` — file signal bus (`qa/shared-task-list.txt`), AG-QREW grammar ported (HAWK-ENV / SECTION-DONE / MODULE-DONE / TC-READY / PROGRESS / BUG-FILED / BLOCKED / DONE), session-stamped, `allDone()` / `blockers()`.
- `src/db.ts` — SQLite (test_cases, runs, results, bugs) — replaces TestRail/Jira.
- `src/agentLoop.ts` — the reusable loop (§4.2): chat → tool_calls → results → loop; guards on max iterations + token budget; BLOCKED path instead of crashing.
- **Adjudication / conflict resolution (Track-3 criterion c)** — `src/adjudicate.ts` (QA Lead as impartial judge via qwen-max, returns UPHELD/DOWNGRADED/REJECTED/RECLASSIFIED + rationale, applies severity/title effects), `src/tools/dispute.ts` (`raise_dispute` tool any worker calls when its evidence contradicts a filed bug), `disputes` table in db.ts, DISPUTE/RESOLVED signals on the bus. Turns the weakest Track-3 sub-criterion ("disagreement/conflict resolution") into a real feature. Wire-up point: the orchestrator (qaLead) drains `db.openDisputes()` in Phase 3 and calls `adjudicate()` on each; the sign-off report lists the adjudications.

Repo already had (copied from AG-QREW prior art): the 5 agent `.md` prompts in `commands/`, README, CLAUDE.md, settings.json. `.env.example` rewritten for DashScope.

## BLOCKER (human task, plan §8 Day 1 — "single most dangerous silent blocker")
- **`DASHSCOPE_API_KEY` is not set.** Nothing runs on Qwen without it. Get it from Model Studio (bailian.console.alibabacloud.com), submit the hackathon credit coupon (approval can take days), and confirm the international vs Singapore region + exact model names (qwen-max / qwen-plus / qwen-vl-max). One tool-call round-trip curl to verify function calling.

## DONE since Day-2 foundation (the whole runnable pipeline — typecheck clean)
1. ✅ **Tool layer** (`src/tools/*.ts` + `index.ts` + `smoke.ts`) — all tools + per-agent registries.
2. ✅ **Prompts** — all 5 ported to `orchestrator/prompts/` (see adaptations note below).
3. ✅ **Orchestrator** (`src/agents/qaLead.ts`) — `runSociety()` phases 0→4, env gate, `proceed`
   checkpoint (auto/stdin/web), dependency-ordered Phase-2 groups, dispute adjudication drain,
   deterministic verdict. Plus `src/agents/worker.ts` (prompt loader + AgentLoop factory + task builders).
4. ✅ **Workers** — qa-tc-writer / qa-api-tester / qa-script-writer / qa-hawk all run as `AgentLoop`
   instances via the factory (no per-file classes; run ORDER encodes the pipeline).
5. ✅ **demo-app/** — Express task-manager + `openapi.yaml` + `PLANTED_BUGS.md`, **4 bugs curl-verified**
   (UI `Tasks (undefined)`, boundary >200 chars, API 200-on-error, data-refresh dispute driver).
6. ✅ **Baseline** (`src/baseline/singleAgent.ts`) — monolithic `allTools` loop; both modes write
   `qa/metrics.json` (keyed society/single).
7. ✅ **server.ts + cli.ts** — Express+SSE with a **minimal inline dashboard** at `/` (Start + Proceed
   buttons, live signal feed, bug/dispute list); CLI `--mode society|single` (+ `--interactive`, `--no-gate`).

Foundation tweaks made to support the above: added `META` signal type (bus.ts + tools/bus.ts) and
per-agent budget caps (`maxIterations`/`maxTokens`) on `AgentConfig`.

### Prompt-port adaptations (real tool set ≠ Claude Code)
**qa-script-writer** → Playwright-as-a-library standalone `tsx` specs (no `@playwright/test`), explores via
a probe script through `playwright_run` (it has no `browser_snapshot`), TestRail IDs → SQLite row ids.
**qa-hawk** → SFDIPOT/FEW HICCUPPS recast onto `browser_snapshot` (qwen-vl) + `http_request`, no
interactive click-driving, no TestRail (results via `result_record`, env verdict via `HAWK-ENV`).

## Offline proof (no API key) — `npm run demo:mock`
`AGQREW_MOCK=1` swaps the Qwen client for a scripted mock (`src/mock/mockQwen.ts`), so the FULL
society path runs on a throwaway DB/bus and self-checks 8 invariants (`src/mock/runMock.ts`):
cases stored, ≥3 bugs filed, exactly 1 dispute, a **rebuttal** recorded on the bus, judge
**RECLASSIFIED** it, disputed bug downgraded, no OPEN dispute, verdict **CONDITIONAL PASS**.
**Verified green.** This proves the wiring (orchestration → dispute → rebuttal → adjudication →
verdict → metrics) independent of the key. The rebuttal round was added to `adjudicate.ts`
(`rebut()` — the filer answers the challenge before the judge rules; surfaced as a PROGRESS signal).
Phase 2 was reordered to a correct topological order (tc-writer → {script-writer, hawk} → api-tester)
so the disputing agent runs after the one it challenges.

## Remaining
- ⏳ **Full React dashboard** (`dashboard/`) — the inline one covers the demo; a real build is optional polish.
- ⏳ **docker-compose.yml** (orchestrator + demo-app + shared `qa/` volume) + `deploy/ecs-setup.md`.
- ⏳ **Docs**: architecture.md + Mermaid→PNG, signals.md, scope-decisions.md, README rewrite, video script.
- ⏳ **Runtime verification of the whole pipeline** — blocked on `DASHSCOPE_API_KEY`. Everything typechecks
  and the demo-app is proven; the first real `npm run run:society` needs the key. Expect to find 4/4 planted
  bugs and ≥1 adjudicated dispute (bug #4 is engineered to force it).

## How to run (once the key is set)
```
# terminal 1 — the app under test
cd demo-app && npm install && npm start          # :3000
# terminal 2 — the QA society
cd orchestrator && cp ../.env.example .env       # paste DASHSCOPE_API_KEY
npx tsx src/smoke.ts                              # de-risk: chat + tool call
npm run run:society                              # or: npm run run:single  (baseline)
npm start                                        # or the web dashboard at :8787
```

## Timing reality
The full runnable pipeline (tasks 1–8) now exists and typechecks; only cloud deploy, the full React
dashboard, and docs remain. The one hard dependency is the API key for end-to-end runtime verification.
