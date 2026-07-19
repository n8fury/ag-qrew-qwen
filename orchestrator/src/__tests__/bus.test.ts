import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bus } from '../bus.js';

const tempBusPath = () => join(mkdtempSync(join(tmpdir(), 'agqrew-bus-')), 'shared-task-list.txt');

describe('Bus', () => {
  it('round-trips a signal through write → parse', () => {
    const bus = new Bus(tempBusPath(), 's1');
    const written = bus.write('BUG-FILED', '#1 [High] title mismatch', 'qa-hawk');
    const parsed = Bus.parse(written.raw);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      type: 'BUG-FILED', payload: '#1 [High] title mismatch', from: 'qa-hawk', session: 's1',
    });
  });

  it('rejects malformed lines', () => {
    expect(Bus.parse('not a signal line')).toBeNull();
    expect(Bus.parse('DONE missing separators')).toBeNull();
    expect(Bus.parse('')).toBeNull();
  });

  it('readAll returns only the current session when sessions interleave in one file', () => {
    const path = tempBusPath();
    const a = new Bus(path, 'session-a');
    const b = new Bus(path, 'session-b');
    a.write('META', 'ctx A', 'qa-lead');
    b.write('META', 'ctx B', 'qa-lead');
    a.write('DONE', 'qa-hawk', 'qa-hawk');
    b.write('BLOCKED', 'env down', 'qa-hawk');

    expect(a.readAll().map((s) => s.payload)).toEqual(['ctx A', 'qa-hawk']);
    expect(b.readAll().map((s) => s.payload)).toEqual(['ctx B', 'env down']);
  });

  it('allDone tracks DONE signals per agent', () => {
    const bus = new Bus(tempBusPath(), 's1');
    expect(bus.allDone(['qa-hawk', 'qa-tc-writer'])).toBe(false);
    bus.write('DONE', 'qa-hawk', 'qa-hawk');
    expect(bus.allDone(['qa-hawk', 'qa-tc-writer'])).toBe(false);
    bus.write('DONE', 'qa-tc-writer', 'qa-tc-writer');
    expect(bus.allDone(['qa-hawk', 'qa-tc-writer'])).toBe(true);
  });

  it('blockers surfaces BLOCKED signals for this session only', () => {
    const path = tempBusPath();
    const other = new Bus(path, 'old-session');
    other.write('BLOCKED', 'stale blocker', 'qa-hawk');
    const bus = new Bus(path, 'live-session');
    expect(bus.blockers()).toHaveLength(0);
    bus.write('BLOCKED', 'site unreachable', 'qa-hawk');
    expect(bus.blockers().map((s) => s.payload)).toEqual(['site unreachable']);
  });

  it('emits a signal event on write', () => {
    const bus = new Bus(tempBusPath(), 's1');
    const seen: string[] = [];
    bus.on('signal', (s) => seen.push(`${s.type}:${s.payload}`));
    bus.write('TC-READY', 'auth', 'qa-tc-writer');
    expect(seen).toEqual(['TC-READY:auth']);
  });
});
