# UPGRADE PLAN — 7 days (deadline extended; 11 days available, 4 kept as buffer)

> Scope: everything needed for a top-tier Track-3 submission INCLUDING Alibaba Cloud ECS
> deployment + proof, a re-recorded hero video, and the metrics story. Days 8–11 are buffer,
> not plan. Budget: the $40 coupon (~$1–2 per society run; whole plan ≈ $15–20).

## Day 1 — Context management in AgentLoop (the one real engineering upgrade)

The root cause of every failure today: each loop iteration re-sends the entire growing
conversation, so a 20-iteration worker burns 250–350k tokens and dies at its budget.

- [ ] `agentLoop.ts`: after a tool result has been consumed for ≥3 iterations, replace its
      content with a 1–2 line summary (`[tool result truncated: fs_read test-plan → 42 lines OK]`).
      Keep the last 3 tool results verbatim. Never truncate the system prompt or task.
- [ ] Cap single tool results at ~4k chars at insertion time (playwright output already is;
      audit http_request and fs_read).
- [ ] Verify with `npm run demo:mock` (8 invariants must stay green) + ONE real society run.
- **Done when:** a full society run completes with NO worker exceeding 150k tokens.
- Cheap extras while in there: `cross-env` for the `demo:mock` script (Windows), and keep
  `probeModels.ts` — document it in README as the quota-debugging tool.

## Day 1 blockers — RESOLVED (root causes + fixes, 2026-07-12)

The Day-1 over-budget numbers had four stacked root causes, all fixed:

1. **Loose guards**: `.env` overrode config with `AGENT_MAX_ITERATIONS=40` / `AGENT_MAX_TOKENS=350000`.
   → Now 25 / 150000 in `.env`, `.env.example`, and the config fallback.
2. **Degenerate tool-call loops**: qa-tc-writer NEVER stored a case in any run (0 rows in every
   attempt DB) — it burned 40 iterations in ~37s re-issuing identical calls (its prompt said
   "poll the bus / filesystem"). Each iteration costs a ~6–7k-token fixed floor (system prompt +
   schemas), so 40 iterations ≈ 300k tokens regardless of compaction.
   → AgentLoop loop guard (identical-call detection + nudge), prompt de-polling, per-iteration
   trace logging (`[agent] iter i/N · +tok · tools`).
3. **Malformed JSON tool arguments** (the qa-api-tester killer): qwen-plus emits
   `function.arguments` with literal newlines/fences on big payloads; the malformed assistant
   message stays in history and DashScope 400s the NEXT request ("function.arguments must be in
   JSON format") — non-retriable death.
   → `parseToolArgs` repairs (escape control chars in strings, strip fences, trailing commas)
   and the loop ALWAYS rewrites valid JSON back into history.
4. **Assistant-side context bloat**: tool-RESULT compaction existed, but `fs_write`/`tc_store`
   payloads live in assistant `tool_calls.arguments` and were re-sent forever (probe showed
   +19k tok/iter by iteration 12).
   → Stale assistant arguments >400 chars collapse to a JSON stub after the same
   keep-last/compact-after rules as results.

Wave 2 (found by run #6's trace): keep-last-1/compact-after-1 was self-defeating — it deleted
the test plan while the agent was still working from it, and the summary text said "re-run the
tool if you need the full output" (tc-writer re-read the plan 19× in a row). Now keep-last-3 /
compact-after-2, summary forbids re-runs, and the loop guard withholds results after 5 identical
(call, result) pairs. Also: qa-api-tester treated 404s from guessed /health paths as "server
unreachable" — Step 0 now requires a spec endpoint and counts ANY HTTP status as reachable.

**Proof — Day-1 criterion MET (run #7, 2026-07-12)**: full society run, every agent `done`,
no worker over 150k: tc-writer 108.8k/13 iters (16 cases stored — first time ever),
script-writer 62.9k/7, hawk explore 131.5k/12, api-tester 119.2k/17. Total 556k, 471s,
5 bugs incl. both priority oracles. Single-agent probe: `src/probeTcWriter.ts`
(71.7k / 8 iters / 13 cases). Mock: all 8 invariants green.
Known env gap for Day 2: qa-script-writer reported "chromium not installed" from
playwright_run — run `npx playwright install chromium` (browser_snapshot's chromium works,
so it's likely a version/path mismatch in the spawned `npx playwright test`).

---

## Day 2 — Precision + the dispute, on camera-quality rails

- [ ] False-positive discipline: worker prompts require quoting the requirement/spec line an
      observation violates inside every `bug_file` (the `oracle` field); qa-lead's sign-off
      already lists bugs — have it flag any bug without a cited oracle.
- [ ] Dispute reliability: api-tester task gets an explicit final step — "read BUG-FILED
      signals; cross-check each UI bug against your API evidence; `raise_dispute` on
      contradiction." Hawk keeps its priority oracles (count header + post-mutation staleness).
- [ ] Run society until one run achieves: **4/4 planted bugs + ≥1 adjudicated dispute +
      executed spec results**. Iterate prompts, not architecture.
- [ ] Save that run's `qa/` artifacts to `docs/sample-run/` (bus transcript, sign-off report,
      adjudication, screenshots) — judges see output without spending tokens.
- [ ] Re-run the single-agent baseline; refresh the README metrics table with both runs.
- **Done when:** README shows a society run with 4/4 + dispute vs the baseline.

## Day 3 — Docker, locally proven

- [ ] Install Docker Desktop. `docker compose up --build` from a clean clone.
- [ ] Fix what the container breaks (usual suspects: Playwright base-image version vs
      package-lock — keep them pinned together; `DEMO_APP_URL=http://demo-app:3000` wiring;
      volume permissions on `qa/`).
- [ ] One full society run INSIDE compose; dashboard + Proceed button from the host browser.
- **Done when:** fresh clone → `cp .env.example orchestrator/.env` + key → `docker compose up`
      → full run, nothing else needed. That is the judge's experience.

## Day 4 — ECS deployment + proof (submission requirement)

- [ ] ECS per `deploy/ecs-setup.md`: 2 vCPU / 4 GB, Ubuntu 24, security group 22/8787(/3000).
- [ ] `git clone` + `.env` + `./deploy/deploy.sh`; full society run in the cloud, dashboard
      reachable at `http://<ip>:8787` from your local browser.
- [ ] **Record the deployment proof** (separate from the demo video): Alibaba Cloud console
      (ECS instance + Model Studio usage page showing the token consumption), SSH terminal
      running `docker compose ps`, live dashboard on the public IP.
- [ ] Add the proof link + `orchestrator/src/qwen.ts` link to the README's Alibaba Cloud section.
- **Done when:** proof recording exists and the instance stays up (it must survive till the
      new deadline — pay-as-you-go, ~cents/day; snapshot the disk as insurance).

## Day 5 — Dashboard + docs polish

- [ ] React dashboard (`dashboard/`, Vite): test-case browser, bug list with dispute/adjudication
      badges, live signal feed, sign-off view. `server.ts` already serves `dashboard/dist` when
      present — zero server changes. Timebox to ONE day; the inline dashboard remains the fallback.
- [ ] README pass with fresh screenshots (dashboard, sign-off, metrics), quickstart re-verified
      on a clean clone, scope-decisions cross-linked.
- [ ] HANDOFF.md updated to post-upgrade reality.
- **Done when:** a stranger can understand and run the project from the README alone.

## Day 6 — Video + blog

- [ ] Re-record the 3-min demo per `docs/video-script.md`, now with the dispute visible on the
      bus and `PLAYWRIGHT_HEADED=1` for the browser shot. Calm voiceover, 1080p, one take after
      one rehearsal. Upload to YouTube (public), verify logged-out playback.
- [ ] Blog post (Blog Post Prize): the honest engineering story — "one AgentLoop, five agents,
      and 7M free-tier tokens: what five Qwen models taught us about tool-calling reliability."
      Material: the model scorecard, 429-vs-403 semantics, context-management fix, dispute design.
- **Done when:** video URL public; blog draft ready to publish.

## Day 7 — Submit

- [ ] Devpost: description (from `docs/devpost-draft.md`), repo URL, video URL, deployment proof,
      architecture diagram, track = Agent Society, blog URL if published.
- [ ] Verify: LICENSE visible in GitHub About, repo public, clean-clone quickstart works,
      video plays logged-out.
- [ ] Submit — then STOP. Days 8–11 are buffer for emergencies only, not feature creep.

## Standing rules

- State hygiene before every recorded/metric run: restart demo-app, `rm -rf orchestrator/qa`.
- Models: lead `qwen-max`, workers `qwen-plus`, vision `qwen-vl-max` (the proven trio).
  429 = wait (client handles it); 403 quota = bucket/billing problem, check the console.
- Cost telemetry: check Expenses → Cost Analysis daily; coupon covers ~20× the planned spend.
- Priority if a day slips: ECS proof > 4/4+dispute run > video > dashboard > blog.
