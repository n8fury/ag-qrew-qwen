# Signal Protocol

The agents coordinate through a **file-based signal bus** — an append-only, human-readable
text file at `qa/shared-task-list.txt`. No message broker, no queue: every line is one
structured signal, and the orchestrator, every agent, and the live dashboard all read the
exact same source of truth. The grammar is ported from the original AG-QREW protocol.

## Wire format

One line per signal:

```
<TYPE>: <payload> | from: <agent> | session: <id> | ts: <iso-8601>
```

Example:

```
BUG-FILED: #3 [High] (tasks) POST /api/tasks returns 200 with an error body | from: qa-api-tester | session: run-42 | ts: 2026-07-09T10:12:03.511Z
```

Signals are session-stamped; stale lines from previous runs are ignored by readers.

## Signal types

| Signal | Emitted by | Meaning |
|---|---|---|
| `META` | orchestrator | Run context seeded onto the bus — project, sprint, site URL, API spec path — so any agent that only reads the bus still gets the full picture |
| `HAWK-ENV` | qa-hawk | Phase-0 environment verdict: `READY` or `BLOCKED`. A `BLOCKED` verdict halts the pipeline before any test effort is spent |
| `SECTION-DONE` | workers | A worker finished a scoped section of its task |
| `MODULE-DONE` | workers | A per-module unit of work completed |
| `TC-READY` | qa-tc-writer | Test cases for a module are stored and available — unblocks downstream consumers (qa-script-writer reads them via `tc_list`) |
| `PROGRESS` | any agent | Heartbeat / status update (also carries dispute rebuttals) |
| `BUG-FILED` | any tester | A bug was recorded in SQLite (id, severity, module, title) |
| `DISPUTE` | any worker | One agent's evidence contradicts another's filed bug — the Track-3 conflict signal. Payload is the dispute id |
| `RESOLVED` | qa-lead | The QA Lead adjudicated a dispute: UPHELD / DOWNGRADED / REJECTED / RECLASSIFIED, with rationale |
| `BLOCKED` | any agent | An agent cannot proceed. Surfaces on the dashboard and in the sign-off report — never crashes the run |
| `DONE` | any agent | The agent finished its whole task |
| `PHASE` | orchestrator | A pipeline phase is starting. Payload `<index>/<total>\|<id>\|<label>` (e.g. `3/9\|approval\|Approval checkpoint`) — drives the dashboard's segmented progress bar; `/api/state` serves the latest one as `phase`. **Only active phases emit a signal**: with a partial input set (see the mode matrix in the README's "Bring your own target"), skipped phases emit no `PHASE` at all, and `index`/`total` count active phases only — a doc-only design run goes `1/4 … 4/4`, never `x/9` |

## Lifecycle of a run

```
META            (orchestrator seeds context)
HAWK-ENV        (Phase 0 gate: READY → continue, BLOCKED → halt)
PROGRESS…       (Phase 1: test plan written; human checkpoint)
TC-READY…       (Phase 2a: cases stored per module)
SECTION-DONE / MODULE-DONE / BUG-FILED…   (Phase 2b/2c: workers execute)
DISPUTE → PROGRESS (rebuttal) → RESOLVED  (Phase 3: adjudication)
DONE…           (each agent signs off)
```

The dispute path is the interesting part: when a worker's evidence contradicts a bug another
agent filed, it calls `raise_dispute`. The original filer gets **one rebuttal round**
(surfaced as a `PROGRESS` signal), then the QA Lead rules on the evidence and writes
`RESOLVED` with the verdict. The sign-off report lists every adjudication.
