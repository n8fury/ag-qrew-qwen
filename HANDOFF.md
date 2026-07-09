# HANDOFF — AG-QREW on Qwen

> The contract for any later session. Bootstrap with two reads: this file +
> `AG-QREW-QWEN-PLAN (1).pdf`. Keep it updated.
> **Deadline: July 10, 3:00 AM GMT+6 — submit on Devpost by ~6 PM July 9.**

## Current state (2026-07-09, Day 5 — submission day)

**All code exists and typechecks.** The pipeline has run end-to-end on real Qwen multiple
times (11 runs today). Best run so far (run #3, qwen-plus workers): 22 cases, 3 bugs filed
including planted bug #1, full sign-off. What has NOT yet happened: a run that finds 4/4
planted bugs + an adjudicated dispute, the baseline metrics run, ECS deploy, video, submission.

### The one blocker: model quota

The free tier gives **1M tokens per model version** (separate buckets). We burned ~5M tokens
across 11 runs learning the runtime and the models. Verdicts (full map in
`probeModels.ts` — run `npx tsx src/probeModels.ts`):

| Worker model | Verdict |
|---|---|
| `qwen-plus` (alias) | **GOOD — the proven config** (run #3). Bucket exhausted |
| `qwen3-max-2025-09-23` | Best protocol quality; reasoning burns ~250k/worker. Exhausted |
| `qwen-plus-latest`, `qwen-plus-2025-07-28` | Unreliable / mediocre. Mostly burned |
| `qwen-flash-2025-07-28`, `qwen3-30b…` | Hopeless at the tool protocol. Burned |
| `qwen-max-2025-01-25`, `qwen-vl-max-2025-08-13`, `qwen-turbo-latest` | 403 Access denied on this key |

**Next step: enable pay-as-you-go** (payment info + disable "free tier only") → set
`QWEN_MODEL_WORKER=qwen-plus` in `orchestrator/.env` → hero run costs <$1.
Error semantics: **429** = per-minute rate window (the client now waits 20–60s and retries);
**403 quota** = bucket dead (switch model); **403 access denied** = model not enabled for key.

## Fixed today (all verified, some still UNCOMMITTED — see git note)

1. `better-sqlite3` ^11→^12 (the v11 binary was macOS-only; v12 has Node-24 Windows prebuilds).
2. fs/playwright tools accept `qa/`-prefixed paths (agents address artefacts as `qa/<p>`).
3. Playwright tools shell through cmd on win32 (`npx` is `npx.cmd` — spawn failed silently).
4. Route documentation in the run context (`siteMap`) — qa-hawk no longer false-BLOCKs on
   guessed paths; cli/server use `DEMO_APP_URL` (Docker networking).
5. Phase-0 env task no longer references the test plan (which doesn't exist until Phase 1).
6. 429 retries wait out the per-minute window (20s→60s, 6 attempts, logged).
7. Phase 2b runs **serially** (script-writer → hawk) — parallel workers on one bucket trip TPM.
8. tc-writer task capped: ≤8 cases/module, one `tc_store` per module (was flailing to budget death).
9. **demo-app login actually works now** — the form had NO submit handler (accidental 5th bug,
   credentials leaked into the query string). Wired: POST /api/auth/login → token → /tasks,
   visible error on bad creds. Probe: `orchestrator/qa/loginProbe.ts` (wiped with qa/; original
   in the session scratchpad). The 4 planted bugs are untouched.
10. Budgets: `AGENT_MAX_ITERATIONS=40`, `AGENT_MAX_TOKENS=250000` (120k cut workers off; 400k
    let bad models burn a whole bucket).

## Added today

- `LICENSE` (MIT) · `docker-compose.yml` + `orchestrator/Dockerfile` (playwright v1.61.1 base,
  must match package-lock) + `demo-app/Dockerfile` · `deploy/ecs-setup.md` + `deploy.sh`
- `docs/`: `architecture.md` + **`architecture.png`** (submission requirement) + `.mmd` source,
  `signals.md`, `scope-decisions.md`, `video-script.md`, `devpost-draft.md`
- `orchestrator/src/probeModels.ts` — model callability probe
- README: Docker quickstart, repo structure, status. **Metrics table still pending** the
  society + baseline runs.

## Blockers needing the human (as of writing)

1. **Pay-as-you-go billing** in Model Studio — unblocks the hero run + baseline.
2. **GPG**: `git commit` fails with pinentry timeout in agent shells. Human must run a commit
   in their own terminal to re-cache the passphrase (or approve committing unsigned).
   Uncommitted: login fix, resilience fixes (6–8), README, docs, HANDOFF.
3. **Docker Desktop** not installed on this Windows machine — blocks the local compose test.
4. **No GitHub remote / no `gh` CLI** — repo is local-only (branch `main`, several commits).

## Remaining tasks, in order

1. Enable billing → `QWEN_MODEL_WORKER=qwen-plus` → wipe `orchestrator/qa`, restart demo-app,
   `npm run run:society` → expect 4/4 planted bugs + ≥1 adjudicated dispute (bug #4 forces it).
2. `npm run run:single` (baseline) → both rows land in `qa/metrics.json` → README table.
3. Commit everything; push to GitHub (private → public at submission).
4. Docker: local `docker compose up` test → ECS (2vCPU/4GB Ubuntu 24) per `deploy/ecs-setup.md`
   → proof recording. Hard cutoff: if ECS fights back past mid-afternoon, record local Docker.
5. Video per `docs/video-script.md` (set `PLAYWRIGHT_HEADED=1` for the browser shot).
6. Devpost per `docs/devpost-draft.md` — submit by ~6 PM, polish after.

## How to run

```bash
# app under test                      # QA society
cd demo-app && npm start              cd orchestrator && npm run run:society
                                      npm run run:single   # baseline
                                      npm start             # dashboard :8787
npm run demo:mock                     # offline proof, no key (8 invariants green)
```

State hygiene between demo runs: kill demo-app, restart it (in-memory data), and
`rm -rf orchestrator/qa` (DB/bus/artifacts) so counts and bugs don't carry over.
