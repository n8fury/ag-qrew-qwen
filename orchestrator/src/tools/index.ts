import type { ToolDef } from '../agentLoop.js';
import type { DB } from '../db.js';
import type { Bus } from '../bus.js';
import { busWriteTool, busReadTool } from './bus.js';
import { tcStoreTool, tcListTool, bugFileTool, resultRecordTool } from './store.js';
import { fsWriteTool, fsReadTool } from './fs.js';
import { httpRequestTool } from './http.js';
import { playwrightRunTool, browserSnapshotTool } from './playwright.js';
import { raiseDisputeTool } from './dispute.js';

export type AgentName = 'qa-lead' | 'qa-tc-writer' | 'qa-api-tester' | 'qa-script-writer' | 'qa-hawk';

export interface ToolDeps {
  db: DB;
  bus: Bus;
  /** the shared qa/ directory all fs/playwright tools are sandboxed to */
  qaRoot: string;
}

/**
 * Per-agent tool registries (plan §4.1) — each agent sees only what its role
 * needs, mirroring the original AG-QREW skill boundaries:
 *   qa-lead          plans + consolidates: files, bus, read-side of the store
 *   qa-tc-writer     writes cases: tc_store (auto TC-READY), files, bus
 *   qa-api-tester    probes the API: http_request, results, bugs, disputes
 *   qa-script-writer generates + runs specs: fs, playwright_run, results, bugs
 *   qa-hawk          smoke + explore: browser_snapshot (qwen-vl), http, bugs
 */
export function toolsFor(agent: AgentName, { db, bus, qaRoot }: ToolDeps): Record<string, ToolDef> {
  const named = (defs: ToolDef[]): Record<string, ToolDef> =>
    Object.fromEntries(defs.map((d) => [d.schema.function.name, d]));

  const busRW = [busWriteTool(bus, agent), busReadTool(bus)];
  const files = [fsWriteTool(qaRoot), fsReadTool(qaRoot)];
  const dispute = raiseDisputeTool(db, bus, agent);

  switch (agent) {
    case 'qa-lead':
      return named([...busRW, ...files, tcListTool(db)]);
    case 'qa-tc-writer':
      return named([...busRW, ...files, tcStoreTool(db, bus, agent), tcListTool(db)]);
    case 'qa-api-tester':
      return named([
        ...busRW, ...files, httpRequestTool(),
        tcListTool(db), bugFileTool(db, bus, agent, qaRoot), resultRecordTool(db), dispute,
      ]);
    case 'qa-script-writer':
      return named([
        ...busRW, ...files, playwrightRunTool(qaRoot),
        tcListTool(db), bugFileTool(db, bus, agent), resultRecordTool(db), dispute,
      ]);
    case 'qa-hawk':
      return named([
        ...busRW, ...files, browserSnapshotTool(qaRoot), httpRequestTool(),
        tcListTool(db), bugFileTool(db, bus, agent), resultRecordTool(db), dispute,
      ]);
  }
}

/** Everything at once — the single-agent baseline (§6) gets the full toolbox. */
export function allTools(deps: ToolDeps): Record<string, ToolDef> {
  const { db, bus, qaRoot } = deps;
  const self = 'single-agent';
  const defs: ToolDef[] = [
    busWriteTool(bus, self), busReadTool(bus),
    fsWriteTool(qaRoot), fsReadTool(qaRoot),
    tcStoreTool(db, bus, self), tcListTool(db),
    bugFileTool(db, bus, self), resultRecordTool(db),
    httpRequestTool(), playwrightRunTool(qaRoot), browserSnapshotTool(qaRoot),
  ];
  return Object.fromEntries(defs.map((d) => [d.schema.function.name, d]));
}
