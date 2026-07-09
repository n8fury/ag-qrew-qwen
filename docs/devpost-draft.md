# Devpost submission draft

**Track:** Track 3 — Agent Society
**Team:** n8fury (Mamdud Hasan) + foyezkabir

## One-liner (project tagline)

An autonomous QA team of five specialized Qwen-powered agents that takes a requirements
document and delivers a complete test cycle — test plan, test cases, executed Playwright
scripts, API tests, filed bugs, and a sign-off report — with one human approval checkpoint.

## Inspiration

A sprint QA cycle is days of skilled-but-repetitive work: read the requirements, write a test
plan, derive cases, automate them, probe the API, explore the UI, file bugs, argue about
severity, sign off. That workflow is a *society* — different specialists with different tools
who coordinate, disagree, and escalate. It maps directly onto Track 3.

## What it does

Point AG-QREW at a requirements doc and a target URL. The QA Lead (qwen-max) validates the
environment through qa-hawk, writes a test plan, and pauses for the one human decision:
**Proceed**. Then four workers execute in a dependency-ordered pipeline, coordinating over a
shared file signal bus:

- **qa-tc-writer** — structured test cases → SQLite
- **qa-script-writer** — generates and *executes* Playwright specs against the app
- **qa-api-tester** — HTTP tests derived from the OpenAPI spec
- **qa-hawk** — SFDIPOT exploratory testing; screenshots analyzed by **qwen-vl-max**

When one agent's evidence contradicts another's bug, it files a **dispute**; the original
filer gets a rebuttal round and the QA Lead adjudicates (UPHELD / DOWNGRADED / REJECTED /
RECLASSIFIED) before writing the sign-off verdict. The repo ships a deliberately buggy demo
app with **exactly 4 documented planted bugs**, so the pipeline's recall is verifiable, plus a
single-agent baseline mode (`--mode single`) and an honest metrics comparison.

## How we built it

No agent framework. One reusable `AgentLoop` (chat → tool_calls → tool results → loop) over
the DashScope OpenAI-compatible endpoint, instantiated five times with different (prompt,
model, tool registry) configs. Typed JSON-schema tools (bus, SQLite store, sandboxed fs, HTTP,
playwright_run, browser_snapshot→qwen-vl, raise_dispute). Express + SSE dashboard. Docker
Compose: orchestrator + demo-app + shared artifact volume. Deployed on Alibaba Cloud ECS.

## Challenges we ran into

- **Free-tier quota engineering**: per-model 1M-token buckets and per-minute rate limits
  forced real resilience work — long-backoff 429 retries, serialized execution groups, and
  per-agent token budgets with a BLOCKED signal path instead of crashes.
- **Model behavior differences**: the same prompts produce wildly different tool-protocol
  adherence across Qwen variants; we probed and routed models per role (qwen-max for
  judgment, qwen-plus tier for volume tool-calling, qwen-vl-max for vision).
- **Windows→Linux portability** of the Playwright tool layer.

## Accomplishments we're proud of

- A working multi-agent runtime on raw Qwen function calling — no framework
- Dispute → rebuttal → adjudication as a first-class, demonstrable feature
- A verifiable demo: 4 documented planted bugs, found and reported autonomously
- One-command run for judges: `docker compose up`

## What we learned

Coordination beats capability: the signal bus, dependency ordering, and budgets mattered more
than any single model's intelligence. And honest metrics (including the unflattering cells)
are a feature.

## What's next

Pluggable adapters for TestRail/Jira (the tool layer is already one schema per capability),
retest loops (Mode 3), flakiness detection, and multilingual requirements intake.

## Built with

TypeScript · Node.js · Qwen (qwen-max, qwen-plus, qwen-vl-max) · Alibaba Cloud Model Studio
(DashScope) · Alibaba Cloud ECS · Playwright · SQLite · Express · Docker Compose

## Links (fill at submission)

- Public repo: `<GitHub URL>`
- Demo video (~3 min, public): `<YouTube URL>`
- Alibaba Cloud deployment proof recording: `<URL>`
- Code file demonstrating Alibaba Cloud API usage: `<repo>/orchestrator/src/qwen.ts`
- Architecture diagram: `<repo>/docs/architecture.png`
