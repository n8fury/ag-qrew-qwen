# Sample run — the Day-2 "hero run" artifacts (2026-07-13)

The complete, unedited `qa/` output of one society run that hit the quality bar:
**4/4 planted bugs + 1 adjudicated cross-agent dispute + executed spec results**,
saved so judges can read a real run without spending any tokens.

> Run context: `--mode society` against the bundled demo-app served on
> `http://localhost:3100` (port 3000 was busy on the host — the port is the only
> difference from the default quickstart). 681k tokens, ~13 min wall-clock,
> qwen-max lead / qwen-plus workers / qwen-vl-max vision.

## What to look at

| Artifact | What it shows |
|---|---|
| [`shared-task-list.txt`](shared-task-list.txt) | The full signal bus — every `META`/`PROGRESS`/`BUG-FILED`/`DISPUTE`/`DONE` line the agents exchanged, in order |
| [`sign-off-report.txt`](sign-off-report.txt) | The QA Lead's final verdict: bug list with quoted oracles, dispute outcome, result tallies |
| [`bugs/bug-report-sprint1.txt`](bugs/bug-report-sprint1.txt) | qa-hawk's exploratory session charter + filed defects |
| [`api-tests/api-results.txt`](api-tests/api-results.txt) | qa-api-tester's per-endpoint ledger |
| [`automation/specs/`](automation/) | qa-script-writer's generated Playwright specs (+ shared runner) |
| [`test-plan-sprint1.txt`](test-plan-sprint1.txt) / [`test-cases/`](test-cases/) | The plan and the stored case files the workers executed against |
| [`screenshots/`](screenshots/) | qa-hawk's vision-model evidence (the `Tasks (undefined)` heading and the stale-delete page are visible) |
| [`metrics.json`](metrics.json) | The run's machine-readable summary (society key) |
| [`agqrew.db`](agqrew.db) | SQLite store — `test_cases`, `results`, `bugs`, `disputes` tables as the run left them |

## The dispute (the Track-3 differentiator, visible end-to-end)

All four planted bugs were caught by the agent each was designed for, and planted
bug #4 produced exactly the designed conflict:

1. **qa-hawk** files bug #2: deleted task still visible on `/tasks` (screenshot evidence).
2. **qa-api-tester**'s mandatory cross-check reproduces the flow at the API layer:
   `DELETE` returns 200 and `GET /api/tasks` omits the task — the data layer is correct.
   It calls `raise_dispute` with that counter-evidence.
3. **qa-lead** adjudicates: **RECLASSIFIED** — a UI-refresh defect, not data integrity
   ("the API correctly removed the task … the issue is with the UI not updating").

Honest notes: bug #5 (Critical, "POST accepted without auth") is a worker
false positive — the live server returns 401; we ship the run as-is rather than
cherry-pick, and the sign-off's FAIL verdict reflects it. Several early spec FAILs
are selector-timeout noise from the script-writer's record-before-repair discipline.
