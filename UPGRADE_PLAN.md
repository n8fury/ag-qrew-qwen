# UPGRADE PLAN — 7 days (deadline extended; 11 days available, 4 kept as buffer)

> Scope: everything needed for a top-tier Track-3 submission INCLUDING Alibaba Cloud ECS
> deployment + proof, a re-recorded hero video, and the metrics story. Days 8–11 are buffer,
> not plan. Budget: the $40 coupon (~$1–2 per society run; whole plan ≈ $15–20).
> This file is intentionally NOT committed.

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

## Day 1 blockers (carry into Day 2)

**Context compaction implemented but insufficient.** Tool result compaction (keep last 1 verbatim, compact after 1 iteration) + 4k char caps reduce total tokens by ~16% (1.08M → 903k baseline) and pass all mock invariants. But real runs show:
- qa-tc-writer: 317k tokens / 40 iterations (2.1× budget)
- qa-script-writer: 356k tokens / 28 iterations (2.4× budget)
- qa-api-tester: 322k tokens / 40 iterations (2.2× budget)

**Root cause found:** `.env` has `AGENT_MAX_ITERATIONS=40` and `AGENT_MAX_TOKENS=350000` — the criterion
was tested with these loose limits. To hit the 150k target, lower the guards: set
`AGENT_MAX_TOKENS=150000` and optionally `AGENT_MAX_ITERATIONS=25` (or leave at 40, but
force lower token budget). The compaction should then demonstrate it keeps workers within budget.

**Next steps for Day 2:**
- Debug iteration limit: verify config, check if agents hit maxTokens before maxIterations
- If looping, tighten prompts to reduce model confusion
- If still over budget after tightening, try more aggressive context pruning (prune old assistant messages, not just results)
- Investigate Qwen API error on qa-api-tester: "function.arguments must be in JSON format"

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
