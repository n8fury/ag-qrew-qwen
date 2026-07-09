import type { ToolDef } from '../agentLoop.js';
import type { Bus, SignalType } from '../bus.js';

const SIGNAL_TYPES: SignalType[] = [
  'META', 'HAWK-ENV', 'SECTION-DONE', 'MODULE-DONE', 'TC-READY',
  'PROGRESS', 'BUG-FILED', 'DISPUTE', 'RESOLVED', 'BLOCKED', 'DONE',
];

/**
 * bus_write / bus_read — the agent-facing half of the shared-task-list protocol.
 * Agents coordinate ONLY through these signals; they never talk to each other
 * directly. `from` is always the calling agent (selfName), never model-supplied.
 */
export function busWriteTool(bus: Bus, selfName: string): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'bus_write',
        description:
          'Append one signal to the shared task list. This is how you coordinate with the other agents. ' +
          'Use TC-READY when test cases for a module are stored, MODULE-DONE / SECTION-DONE when a unit of work completes, ' +
          'PROGRESS for heartbeats, BLOCKED when you cannot proceed, DONE only when your entire task is finished.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: SIGNAL_TYPES, description: 'signal type' },
            payload: { type: 'string', description: 'signal payload, e.g. "login" for TC-READY: login' },
          },
          required: ['type', 'payload'],
        },
      },
    },
    run: (args: { type: SignalType; payload: string }) => {
      if (!SIGNAL_TYPES.includes(args.type)) return `ERROR: unknown signal type ${args.type}`;
      const sig = bus.write(args.type, args.payload, selfName);
      return `Signal written: ${sig.raw}`;
    },
  };
}

export function busReadTool(bus: Bus): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'bus_read',
        description:
          'Read signals from the shared task list (current session only). Use this to check for TC-READY modules to pick up, BLOCKED agents, or DONE signals. Returns the most recent signals first.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: SIGNAL_TYPES, description: 'only return signals of this type (optional)' },
            limit: { type: 'integer', description: 'max signals to return (default 20)' },
          },
          required: [],
        },
      },
    },
    run: (args: { type?: SignalType; limit?: number }) => {
      let sigs = bus.readAll();
      if (args.type) sigs = sigs.filter((s) => s.type === args.type);
      const limit = args.limit && args.limit > 0 ? args.limit : 20;
      const out = sigs.slice(-limit).reverse().map((s) => s.raw);
      return out.length ? out.join('\n') : '(no matching signals yet)';
    },
  };
}
