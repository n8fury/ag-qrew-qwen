# HANDOFF — AG-QREW on Qwen

> The contract for any later session. Bootstrap with two reads: this file +
> [`UPGRADE_PLAN.md`](UPGRADE_PLAN.md) (the day-by-day source of truth, with per-day
> DONE proofs). Deadline extended — 7 plan days + 4 buffer days; see the plan header.

## Current state (2026-07-13, Day 2 complete — only human-side steps left besides video/blog/submit)

**Code-complete and typecheck-clean across orchestrator + dashboard.** The society runs
end-to-end on real Qwen within budget, in Docker, with adjudicated disputes on the bus.

| Plan day | Status |
|---|---|
| **1 — Context management** | ✅ DONE with proof (run #7): full society run, every agent `done`, **no worker over 150k tokens**. Root causes + fixes documented in UPGRADE_PLAN. |
| **2 — Precision + dispute** | ✅ DONE with proof (hero run, 2026-07-13): **4/4 planted bugs + 1 adjudicated cross-agent dispute (RECLASSIFIED — the designed hawk↔api-tester conflict) + 14 executed results** in one run. Full artifacts committed at [`sample-run/`](sample-run/); the 5-run iteration log (what each failure taught) is in UPGRADE_PLAN's Day-2 DONE section. |
| **3 — Docker** | ✅ DONE with proof: full society run inside compose, driven from the host. Two container fixes: `qwen.ts` passes native `fetch` (openai SDK dead on Node 24), openapi.yaml bind mount. |
| **4 — ECS + proof** | 🟡 Repo side ready (deploy assets, README proof slot at `TODO(day-4)`). The cloud steps are human-only: [`DAY4_CHECKLIST.md`](DAY4_CHECKLIST.md). |
| **5 — Dashboard + docs** | ✅ DONE. React dashboard (`dashboard/`, Vite): live SSE signal feed, test-case browser with filters, bug list with dispute/adjudication badges, sign-off + metrics view. `dashboard/dist` is **committed**; server serves it, inline page remains the fallback. README refreshed with real-run screenshots (`docs/screenshots/`). |
| **6 — Video + blog** | ⏳ Not started ([`video-script.md`](video-script.md) ready). |
| **7 — Submit** | ⏳ Not started ([`devpost-draft.md`](devpost-draft.md) ready). |

## Remaining tasks, in order

1. **ECS deploy + proof recording** — follow [`DAY4_CHECKLIST.md`](DAY4_CHECKLIST.md)
   click by click; paste the recording URL into README (`TODO(day-4)` marker).
2. **Video** per [`video-script.md`](video-script.md) (dispute visible on the bus,
   `PLAYWRIGHT_HEADED=1` for the browser shot) → YouTube, verify logged-out playback.
3. **Blog draft** (prize track): the model scorecard / 429-vs-403 / context-management
   story — plus the Day-2 finding: task-string deliverable contracts beat system-prompt
   rules for worker-scale models (see UPGRADE_PLAN Day-2 DONE).
4. **Devpost submission** per [`devpost-draft.md`](devpost-draft.md), then STOP.

Priority if time slips: ECS proof > video > blog.

## How to run

```bash
# judges' path — one command
cp .env.example orchestrator/.env       # paste DASHSCOPE_API_KEY (International Model Studio)
docker compose up --build               # → http://localhost:8787 → Start run → Proceed

# bare-metal dev
cd demo-app && npm install && npm start            # app under test :3000
cd orchestrator && npm install
npm run demo:mock                                  # offline proof, no key — 8 invariants green
npm run run:society | npm run run:single           # CLI runs
npm start                                          # server + dashboard :8787

# dashboard dev (only if changing UI)
cd dashboard && npm install && npm run dev         # Vite dev server, proxies /api → :8787
npm run build                                      # refresh committed dist/
```

## Things a new session must know

- **State hygiene before every recorded/metric run**: restart demo-app (in-memory data),
  `rm -rf orchestrator/qa` so counts don't carry over.
- **Models**: lead `qwen-max`, workers `qwen-plus`, vision `qwen-vl-max` (the proven trio).
  **429** = per-minute window, client waits and retries. **403 quota** = bucket dead —
  console problem, don't retry. `npx tsx src/probeModels.ts` maps callability per model.
- **Budgets**: `AGENT_MAX_ITERATIONS=25`, `AGENT_MAX_TOKENS=150000` (.env; enforced by
  AgentLoop with compaction keep-last-3 / compact-after-2 + identical-call loop guard).
- **The mock sandbox**: `npm run demo:mock` writes ALL artifacts (DB, bus, metrics,
  sign-off) to a temp dir via the `qaRoot` option — it must never touch `./qa`.
- **Dashboard serving**: `server.ts` serves `dashboard/dist` only if `dist/index.html`
  exists, else the inline page; compose bind-mounts `./dashboard/dist` read-only.
  `/api/report` exposes `qa/sign-off-report.txt` + `qa/metrics.json`; `/api/state`
  falls back to the last bus session on file so a restarted server still shows the run.
- **Playwright in specs**: known env gap on this Windows host — `npx playwright install chromium`
  if `playwright_run` reports "chromium not installed" (browser_snapshot works regardless).
- **Commits**: the human commits (GPG-signed) — prepare the message, don't run `git commit`.
- **Cost**: check Model Studio Expenses → Cost Analysis daily; coupon covers ~20× planned spend.
