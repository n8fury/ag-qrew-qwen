# Scope Decisions

AG-QREW began as a Claude Code skill pipeline that integrated with a real QA toolchain
(TestRail, Jira, Postman, MCP-driven Playwright). Rebuilding it as a standalone multi-agent
runtime on Qwen forced a deliberate scope pass. Every cut below is a decision, not an
accident — the goal was a system a judge can run end-to-end with `docker compose up` and
no third-party accounts.

## Dropped, and why

| Original dependency | Decision | Replacement |
|---|---|---|
| **TestRail** (test case management) | Dropped | SQLite (`test_cases`, `runs`, `results` tables) + the built-in web dashboard. Same data model, zero accounts |
| **Jira / Confluence** (bug tracking, doc intake) | Dropped | Bug store in SQLite + dashboard view; document intake is paste/file/URL |
| **Postman / Newman** (API testing) | Dropped | qa-api-tester issues direct HTTP calls via its `http_request` tool, driven by the OpenAPI spec |
| **Playwright via MCP** | Replaced | Playwright as a plain library: the qa-script-writer generates standalone `tsx` specs executed through the `playwright_run` tool; screenshots go to qwen-vl-max via `browser_snapshot` |
| **Claude Code runtime** (sub-agent spawning, tool loop) | Rebuilt | Our own orchestrator: one reusable `AgentLoop` over the Qwen function-calling API, instantiated five times with different (prompt, model, tools) configs |

**The reasoning:** judges do not have TestRail/Jira/Postman accounts. A submission they
cannot run scores poorly regardless of quality. A self-contained SQLite + dashboard stack
turns the whole pipeline into a one-command demo. The dropped integrations are pluggable
adapters in a production deployment — the tool layer is already one typed function + JSON
schema per capability, so a `tc_store` that writes to TestRail instead of SQLite is a
drop-in swap.

## Kept

- **The 5 agent prompts** — trimmed of Claude-Code-specific tool references, otherwise intact.
- **The signal protocol** (`qa/shared-task-list.txt`) — human-readable, demo-friendly, needs no broker. See [signals.md](signals.md).
- **SFDIPOT / FEW HICCUPPS heuristics** — model-agnostic domain knowledge.
- **The phase structure (0–4)** and the single human `proceed` checkpoint.
- **GitHub Actions CI yaml generation** by qa-script-writer — costs nothing, shows polish.

## Consciously cut (future work)

- Mobile viewport execution (the `@mobile` tag concept survives in the TC format).
- Sprint health scan (needed Jira).
- Flakiness detection (`--repeat-each=3`), axe accessibility soft checks, the Mode-3 retest
  loop, multilingual inquiry docs — stretch items that lost to the deadline.
- WebKit/Firefox: Chromium only, for image size and time.
