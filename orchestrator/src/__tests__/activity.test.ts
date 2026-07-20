import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Scripted model: each test pushes the exact turns it wants the "model" to take.
const { script } = vi.hoisted(() => ({ script: [] as any[] }));
vi.mock('../qwen.js', () => ({
  chat: async () => {
    const next = script.shift();
    if (!next) throw new Error('mock chat script exhausted');
    return next;
  },
}));

import { AgentLoop } from '../agentLoop.js';
import { Bus, type ActivityEvent } from '../bus.js';

const tempBusPath = () => join(mkdtempSync(join(tmpdir(), 'agqrew-activity-')), 'shared-task-list.txt');

const toolTurn = (usageTokens: number, n: number) => ({
  usageTokens,
  message: {
    role: 'assistant', content: null,
    tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'ping', arguments: JSON.stringify({ n }) } }],
  },
});
const textTurn = (usageTokens: number, text = 'all done') => ({
  usageTokens,
  message: { role: 'assistant', content: text },
});

const pingTool = {
  schema: { type: 'function' as const, function: { name: 'ping', parameters: { type: 'object', properties: {} } } },
  run: () => 'pong',
};

function makeLoop(bus: Bus, name = 'test-agent', maxIterations = 10) {
  return new AgentLoop({
    name, model: 'worker', systemPrompt: 'test', tools: { ping: pingTool }, bus, maxIterations,
  });
}

describe('AgentLoop activity telemetry (Phase F)', () => {
  it('emits one activity per iteration with cumulative tokens; the bus FILE stays clean', async () => {
    const path = tempBusPath();
    const bus = new Bus(path, 's1');
    const events: ActivityEvent[] = [];
    bus.on('activity', (e: ActivityEvent) => events.push(e));

    script.push(toolTurn(100, 1), toolTurn(200, 2), textTurn(50));
    const outcome = await makeLoop(bus).run('do the thing');

    expect(outcome.status).toBe('done');
    expect(events).toHaveLength(3); // one per iteration
    expect(events[0]).toMatchObject({
      agent: 'test-agent', iter: 1, maxIter: 10,
      tokensAgent: 100, tokensDelta: 100, calls: ['ping'], state: 'working', tokensRun: 100,
    });
    expect(events[1]).toMatchObject({ iter: 2, tokensAgent: 300, tokensDelta: 200, state: 'working', tokensRun: 300 });
    expect(events[2]).toMatchObject({ iter: 3, tokensAgent: 350, tokensDelta: 50, calls: [], state: 'done', tokensRun: 350 });

    // The bus file is the persistent protocol log — activity must NEVER land in it.
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1); // only the DONE signal
    expect(lines[0].startsWith('DONE:')).toBe(true);
    expect(readFileSync(path, 'utf8')).not.toMatch(/ACTIVITY|tokensRun|working/);
  });

  it('tokensRun accumulates across agents on the same bus (finished + live)', async () => {
    const bus = new Bus(tempBusPath(), 's1');
    const events: ActivityEvent[] = [];
    bus.on('activity', (e: ActivityEvent) => events.push(e));

    script.push(textTurn(70));
    await makeLoop(bus, 'agent-a').run('a');
    script.push(textTurn(30));
    await makeLoop(bus, 'agent-b').run('b');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ agent: 'agent-a', tokensAgent: 70, tokensRun: 70 });
    expect(events[1]).toMatchObject({ agent: 'agent-b', tokensAgent: 30, tokensRun: 100 });
  });

  it('terminal blocked state at the iteration cap', async () => {
    const bus = new Bus(tempBusPath(), 's1');
    const events: ActivityEvent[] = [];
    bus.on('activity', (e: ActivityEvent) => events.push(e));

    script.push(toolTurn(40, 1));
    const outcome = await makeLoop(bus, 'capped', 1).run('loop forever');

    expect(outcome.status).toBe('exhausted');
    expect(events).toHaveLength(2); // iteration 1 (working) + the cap event
    expect(events[0]).toMatchObject({ iter: 1, state: 'working', tokensAgent: 40 });
    expect(events[1]).toMatchObject({ iter: 1, maxIter: 1, state: 'blocked', tokensDelta: 0, tokensRun: 40 });
  });
});
