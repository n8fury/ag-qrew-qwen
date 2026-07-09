# Demo video — script + shot list (~3:00)

**Rules:** no dead time, no typing on camera (pre-stage everything), voiceover written below,
1080p, record in one take after one full rehearsal. Demo-app freshly restarted, `qa/` wiped,
dashboard open at :8787, terminal font ≥16pt.

| # | Time | Shot | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:20 | Title card → quick cut of a sprint board / requirements doc | "Every sprint, QA burns days turning a requirements doc into test plans, cases, scripts, API tests and bug reports. We built a team that does the whole cycle autonomously — on Qwen." |
| 2 | 0:20–0:50 | Dashboard: paste the requirements doc, click **Start**. Test plan appears. Cursor hovers **Proceed**, clicks. | "This is AG-QREW: five specialized agents on Alibaba Cloud Model Studio. The QA Lead reads the doc and writes a test plan. One human decision — approve the plan — and everything after is autonomous." |
| 3 | 0:50–1:50 | Split screen: live signal feed scrolling (META, TC-READY, PROGRESS, BUG-FILED) + test cases filling the browser. Cut to a Playwright browser window driving the app for ~5s. Cut to a bug entry with a screenshot: qwen-vl's analysis text visible. | "The society coordinates over a shared signal bus — no framework, our own agent runtime on Qwen function calling. The tc-writer stores structured cases; the script-writer generates and executes real Playwright specs; the api-tester probes the OpenAPI contract; and qa-hawk explores the UI, sending screenshots to Qwen-VL for analysis. Every bug lands in SQLite with severity and evidence." |
| 4 | 1:50–2:20 | Sign-off report on the dashboard. Open `PLANTED_BUGS.md` side-by-side; point at each found bug. If a dispute occurred: show the DISPUTE → rebuttal → RESOLVED lines on the bus. | "The demo app ships with exactly four documented planted bugs. The society found them — verifiably. And when two agents disagreed about a finding, the QA Lead adjudicated the dispute with a rebuttal round before signing off." |
| 5 | 2:20–2:45 | README metrics table, zoomed. | "Track 3 asks for a measurable edge over a single agent. Same job, one monolithic agent: here are the honest numbers — and one thing no solo agent can do is resolve a disagreement." |
| 6 | 2:45–3:00 | Architecture diagram PNG. End card: repo URL + "Qwen-Max · Qwen-Plus · Qwen-VL-Max on Alibaba Cloud Model Studio". | "One reusable agent loop, five configs, three Qwen models, one command to run it. AG-QREW, on Qwen." |

**Pre-stage checklist (do BEFORE recording):**
- [ ] `docker compose up` (or `npm start`) running clean; dashboard reachable
- [ ] Demo-app freshly restarted (seed data only), `qa/` wiped
- [ ] Requirements doc in clipboard
- [ ] `PLANTED_BUGS.md`, README metrics table, and `docs/architecture.png` open in tabs
- [ ] `PLAYWRIGHT_HEADED=1` so the browser is visible for shot 3
- [ ] Screen recorder at 1080p, mic checked, notifications off
