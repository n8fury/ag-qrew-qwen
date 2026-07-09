import type { ToolDef } from '../agentLoop.js';
import type { DB, TestCase, Bug, Result } from '../db.js';
import type { Bus } from '../bus.js';

/**
 * Store tools — the SQLite-backed replacements for TestRail/Jira.
 * tc_store auto-emits TC-READY and bug_file auto-emits BUG-FILED so the
 * pipeline can never stall on a forgotten signal.
 */
export function tcStoreTool(db: DB, bus: Bus, selfName: string): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'tc_store',
        description:
          'Persist all test cases for one module to the test database (atomic, local — no pacing or retries needed). Returns the permanent row id for each case in order — write these back into the TC ID lines of the .txt file. Automatically emits TC-READY: {module} on the bus.',
        parameters: {
          type: 'object',
          properties: {
            module: { type: 'string', description: 'module the cases belong to, e.g. "login" or "settings > profile"' },
            cases: {
              type: 'array',
              description: 'the test cases to store, in TC-ref order',
              items: {
                type: 'object',
                properties: {
                  tc_ref: { type: 'string', description: 'sequential ref from the .txt file, e.g. "TC-001"' },
                  title: { type: 'string', description: 'starts with "Verify that"' },
                  section: {
                    type: 'string',
                    enum: ['UI', 'Functional — Positive', 'Functional — Negative / Boundary', 'Mobile Responsive'],
                  },
                  type: { type: 'string', enum: ['Functional', 'Negative', 'Boundary', 'Edge', 'UI', 'Mobile'] },
                  priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                  preconditions: { type: 'string', description: 'each line prefixed "- ", real newlines' },
                  steps: { type: 'string', description: 'numbered human actions, real newlines' },
                  test_data: { type: 'string', description: 'one "key: value" pair per line, or "N/A"' },
                  expected: { type: 'string', description: 'each line prefixed "- ", real newlines' },
                  tag: { type: 'string', description: 'optional tag, e.g. "smoke"' },
                },
                required: ['tc_ref', 'title', 'section', 'type', 'priority', 'preconditions', 'steps', 'test_data', 'expected'],
              },
            },
          },
          required: ['module', 'cases'],
        },
      },
    },
    run: (args: { module: string; cases: Omit<TestCase, 'module'>[] }) => {
      if (!args.cases?.length) return 'ERROR: cases array is empty.';
      const rows = args.cases.map((c) => ({ ...c, module: args.module }));
      const ids = db.storeCases(rows as TestCase[]);
      bus.write('TC-READY', args.module, selfName);
      const mapping = args.cases.map((c, i) => `${c.tc_ref} → ${ids[i]}`).join(', ');
      return `Stored ${ids.length} test cases for module "${args.module}". TC-READY emitted. Row ids: ${mapping}`;
    },
  };
}

export function tcListTool(db: DB): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'tc_list',
        description: 'List stored test cases, optionally filtered by module. Returns id, module, title, type, steps, expected.',
        parameters: {
          type: 'object',
          properties: {
            module: { type: 'string', description: 'only cases for this module (optional)' },
          },
          required: [],
        },
      },
    },
    run: (args: { module?: string }) => {
      const cases = db.listCases(args.module);
      if (!cases.length) return args.module ? `(no test cases stored for module "${args.module}")` : '(no test cases stored yet)';
      return cases
        .map((c) =>
          `#${c.id} [${c.module}] ${c.tc_ref} (${c.type}, ${c.priority}) ${c.title}\n` +
          `  preconditions: ${c.preconditions}\n  steps: ${c.steps}\n  test data: ${c.test_data}\n  expected: ${c.expected}`
        )
        .join('\n');
    },
  };
}

export function bugFileTool(db: DB, bus: Bus, selfName: string): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'bug_file',
        description:
          'File a bug with full evidence. Automatically emits BUG-FILED on the bus. Returns the bug id — reference it if another agent later disputes your finding.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'one-line bug title' },
            severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
            module: { type: 'string', description: 'affected module' },
            oracle: { type: 'string', description: 'which oracle failed (FEW HICCUPPS), e.g. "Claims: contradicts the OpenAPI spec"' },
            steps: { type: 'string', description: 'numbered reproduction steps' },
            expected: { type: 'string', description: 'expected behaviour' },
            actual: { type: 'string', description: 'actual observed behaviour' },
            evidence: { type: 'string', description: 'concrete evidence: response body, screenshot path, console error (optional)' },
          },
          required: ['title', 'severity', 'module', 'oracle', 'steps', 'expected', 'actual'],
        },
      },
    },
    run: (args: Omit<Bug, 'found_by'>) => {
      const id = db.fileBug({ ...args, found_by: selfName });
      bus.write('BUG-FILED', `#${id} [${args.severity}] ${args.title}`, selfName);
      return `Bug #${id} filed (${args.severity}). BUG-FILED emitted. Continue testing.`;
    },
  };
}

export function resultRecordTool(db: DB): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'result_record',
        description: 'Record the execution result of one stored test case. Use the case id from tc_list.',
        parameters: {
          type: 'object',
          properties: {
            case_id: { type: 'integer', description: 'id of the test case executed' },
            status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED', 'SKIP'] },
            note: { type: 'string', description: 'short note, e.g. failure detail or blocker reason (optional)' },
          },
          required: ['case_id', 'status'],
        },
      },
    },
    run: (args: Result) => {
      db.recordResult(args);
      return `Result recorded: case #${args.case_id} → ${args.status}.`;
    },
  };
}
