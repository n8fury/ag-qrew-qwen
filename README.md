# AG-QREW on Qwen

> An autonomous QA team of **five specialized Qwen-powered agents** that takes a requirements
> document and delivers a complete test cycle — test plan, test cases, executed Playwright
> scripts, API tests, filed bugs, and a sign-off report — with **one human approval checkpoint**.

**Hackathon track:** Track 3 — Agent Society · **Models:** Alibaba Cloud Model Studio (Qwen) · **Stack:** TypeScript / Node 20

---

## What it is

AG-QREW is a multi-agent QA automation pipeline. Point it at a requirements doc, approve the
generated test plan once, and a society of agents autonomously writes and runs the rest of the
sprint's QA — coordinating through a shared signal bus, persisting everything to SQLite, and
resolving their own disagreements before the QA Lead signs off.

The interesting engineering isn't the QA — it's that we **rebuilt a multi-agent orchestration
runtime on the Qwen function-calling API** (sub-agent spawning, a tool loop, a signal bus,
conflict resolution) rather than relying on any framework. See [`orchestrator/src/agentLoop.ts`](orchestrator/src/agentLoop.ts).

---

## Why this fits Track 3 (Agent Society)

Track 3 asks for (a) multiple agents with distinct capabilities, (b) task decomposition & role
assignment, (c) disagreement/conflict resolution, and (d) a measurable gain over a single-agent baseline.

| Requirement | How AG-QREW delivers it |
|---|---|
| **(a) Distinct agents** | 5 roles — QA Lead + 4 workers, each with its own prompt, model tier, and tool set |
| **(b) Decomposition / roles** | The QA Lead writes a plan, then spawns workers in a dependency-ordered pipeline; they coordinate only via the signal bus |
| **(c) Conflict resolution** | Agents `raise_dispute` when their evidence contradicts another's finding → **one rebuttal round** → the QA Lead **adjudicates** (UPHELD / DOWNGRADED / REJECTED / RECLASSIFIED). This is the differentiator — see below |
| **(d) Efficiency vs baseline** | `--mode single` runs the same job as one monolithic agent; both write `qa/metrics.json` for a head-to-head table. The solo agent *structurally* cannot raise disputes (it has no `raise_dispute` tool), so conflict resolution is provably a property of the society |

---

## Architecture

```mermaid
flowchart TD
    USER([requirements doc]) --> LEAD[QA Lead · qwen-max]
    LEAD -->|Phase 0| ENV[qa-hawk: environment gate]
    ENV -->|HAWK-ENV READY| PLAN[Phase 1: test plan]
    PLAN --> CHK{{proceed? · the one human checkpoint}}
    CHK -->|approved| TC[qa-tc-writer]
    TC -->|TC-READY| SCRIPT[qa-script-writer]
    TC --> HAWK[qa-hawk: explore + qwen-vl]
    SCRIPT --> API[qa-api-tester]
    HAWK --> API
    API -->|raise_dispute| ADJ[Phase 3: QA Lead adjudicates disputes]
    SCRIPT --> ADJ
    HAWK --> ADJ
    ADJ --> SIGN[Phase 4: sign-off · PASS / CONDITIONAL / FAIL]
    subgraph BUS[shared signal bus + SQLite store]
    end
```

- **AgentLoop** (`agentLoop.ts`) — one reusable class instantiated per agent: `chat → tool_calls → results → loop`; guards on per-agent iteration and token budgets; a `BLOCKED` path instead of crashing.
- **Signal bus** (`bus.ts`) — append-only `qa/shared-task-list.txt`, human-readable, streamed live to the dashboard over SSE. Grammar: `META · HAWK-ENV · TC-READY · SECTION-DONE · BUG-FILED · DISPUTE · RESOLVED · BLOCKED · DONE`.
- **Tool layer** (`tools/`) — typed JSON-schema functions for Qwen function calling: `bus_read/write`, `tc_store/list`, `bug_file`, `result_record`, `fs_read/write` (sandboxed to `qa/`), `http_request`, `playwright_run`, `browser_snapshot` (→ qwen-vl), `raise_dispute`. Each agent sees only the tools its role needs.
- **Persistence** (`db.ts`) — SQLite tables: `test_cases`, `runs`, `results`, `bugs`, `disputes`. Replaces TestRail/Jira so a judge can run everything with no external accounts.
- **DashScope client** (`qwen.ts`) — OpenAI-compatible endpoint with retry/backoff and a token tally. **This is the file demonstrating Alibaba Cloud API usage.**

### The five agents

| Agent | Model | Role | Key tools |
|---|---|---|---|
| **qa-lead** | qwen-max | Test plan (Mode 1), dispute adjudication, sign-off (Mode 2) | bus, fs, tc_list |
| **qa-tc-writer** | qwen-plus | Structured test cases → SQLite | tc_store, tc_list, fs, bus |
| **qa-api-tester** | qwen-plus | HTTP tests from the OpenAPI spec; files contract bugs | http_request, bug_file, result_record, raise_dispute |
| **qa-script-writer** | qwen-plus | Playwright-as-a-library specs, executed via `playwright_run` | playwright_run, bug_file, result_record, raise_dispute |
| **qa-hawk** | qwen-plus (+ qwen-vl-max) | Smoke + SFDIPOT exploratory testing; screenshot analysis | browser_snapshot, http_request, bug_file, raise_dispute |

### Conflict resolution (the differentiator)

When one agent's evidence contradicts another's filed bug — e.g. qa-hawk reports *"deleted task
still shows in the UI"* while qa-api-tester finds *"DELETE returns 200 and the API list omits it"*
— the second agent calls `raise_dispute`. The QA Lead then runs a **one-round debate**: the
original filer gets a rebuttal, and the Lead rules as an impartial judge, adjusting the bug's
severity/classification. In this example it **reclassifies** the finding from a data bug to a
UI-refresh bug. See [`adjudicate.ts`](orchestrator/src/adjudicate.ts).

---

## Quickstart

### Option A — offline proof (no API key)

Verifies the entire society path (orchestration → bug → dispute → rebuttal → adjudication →
verdict → metrics) against a mock model:

```bash
cd orchestrator && npm install
npm run demo:mock
```

Expect `✅ MOCK PASS` with 8 green invariants.

### Option B — the real thing (needs a Qwen key)

```bash
# 1. the app under test
cd demo-app && npm install && npm start          # http://localhost:3000

# 2. the QA society
cd orchestrator && npm install
cp ../.env.example .env                           # paste DASHSCOPE_API_KEY (International Model Studio)
npx tsx src/smoke.ts                              # de-risk: 1 chat + 1 tool-call round-trip
npm run run:society                              # the 5-agent pipeline
#   or: npm run run:single                       # the monolithic baseline
npm start                                        # web dashboard at http://localhost:8787
```

CLI flags: `--mode society|single`, `--interactive` (human proceed gate via stdin), `--no-gate`, `--site <url>`, `--spec <path>`.

---

## Society vs single-agent baseline

Both modes run the same job and write `qa/metrics.json` (keyed `society` / `single`):
wall-clock, total tokens, bugs found, test cases, results, verdict. Run both and compare — and
report the numbers honestly, including any unflattering cell. Structurally, the single agent
raises **0 disputes** (no `raise_dispute` tool), which is itself the point: conflict resolution
emerges only from the society.

---

## Demo target app

[`demo-app/`](demo-app/) is a deliberately buggy Express task-manager (login + task CRUD + REST
API + `openapi.yaml`) with **exactly 4 planted bugs**, documented in
[`demo-app/PLANTED_BUGS.md`](demo-app/PLANTED_BUGS.md), each designed for a different agent to catch:

1. **UI** — tasks header renders `Tasks (undefined)` (qa-hawk, qwen-vl)
2. **Boundary** — a >200-char title is accepted (qa-api-tester)
3. **Contract** — `POST /api/tasks` returns **200 with an error body** when title is missing (qa-api-tester)
4. **Data-refresh** — a deleted task persists in the HTML list though the API is correct → **forces the qa-hawk ↔ qa-api-tester dispute** (adjudicated as a UI bug)

A pipeline that provably finds 4/4 known bugs is a stronger demo than one pointed at a random site.

---

## Repo structure

```
ag-qrew-qwen/
├── README.md · HANDOFF.md · .env.example · .gitignore
├── orchestrator/
│   ├── prompts/            # 5 agent system prompts (ported & adapted to the Qwen tools)
│   └── src/
│       ├── agentLoop.ts    # the reusable agent runtime
│       ├── qwen.ts         # DashScope client (Alibaba Cloud API usage)
│       ├── bus.ts · db.ts · config.ts · adjudicate.ts
│       ├── tools/          # one file per tool
│       ├── agents/         # qaLead.ts (orchestrator) + worker.ts (agent factory)
│       ├── baseline/       # singleAgent.ts (Track-3 baseline)
│       ├── mock/           # offline proof harness (mockQwen.ts + runMock.ts)
│       ├── cli.ts · server.ts · smoke.ts
└── demo-app/               # buggy target app + openapi.yaml + PLANTED_BUGS.md
```

Two conscious deviations from a textbook layout: workers are built by a **factory** (`worker.ts`)
from the prompt files rather than four near-identical classes; and the dashboard is an **inline
page** served by `server.ts` (zero build step) — `server.ts` serves `dashboard/dist` instead if a
full React build is added later.

---

## Alibaba Cloud usage

All model calls go through the DashScope (Model Studio) OpenAI-compatible endpoint via
[`orchestrator/src/qwen.ts`](orchestrator/src/qwen.ts). Configure the key and models in `.env`
(`DASHSCOPE_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL_LEAD/WORKER/VISION`). Use the **International
Model Studio** console (Singapore) so the key matches the `dashscope-intl` endpoint.

---

## Attribution

AG-QREW began as a [Claude Code](https://claude.com/claude-code) skill pipeline (our own prior
work). For this hackathon we **rebuilt it from scratch as a standalone multi-agent runtime on
Qwen** — the Claude Code sub-agent/tool/MCP runtime was replaced by our own `AgentLoop`,
function-calling tool layer, file signal bus, and SQLite store. TestRail/Jira/Postman integrations
were dropped in favour of a self-contained SQLite + dashboard stack so the whole system runs with
one command and no external accounts (they remain documentable as pluggable adapters).

---

## Status

- ✅ Runtime, 5 agents, tool layer, demo-app (4 bugs curl-verified), baseline, CLI, server + inline dashboard — **code-complete, typecheck clean**.
- ✅ Full society path **verified offline** via `npm run demo:mock` (no key needed).
- ⏳ Live end-to-end run on real Qwen — pending `DASHSCOPE_API_KEY`.
- ⏳ Docker Compose + Alibaba Cloud ECS deploy, architecture-diagram export, full React dashboard.

See [HANDOFF.md](HANDOFF.md) for the exact state and remaining tasks.

## License

MIT.
