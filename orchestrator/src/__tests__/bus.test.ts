import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Bus, latestPhase, parsePhase } from '../bus.js';

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

  it('parsePhase round-trips a PHASE payload and rejects malformed ones', () => {
    expect(parsePhase('3/9|approval|Approval checkpoint')).toEqual({
      index: 3, total: 9, id: 'approval', label: 'Approval checkpoint',
    });
    expect(parsePhase('9/9|signoff|Sign-off')).toMatchObject({ index: 9, total: 9 });
    expect(parsePhase('running')).toBeNull();
    expect(parsePhase('a/b|x|y')).toBeNull();
  });

  it('latestPhase returns the most recent well-formed PHASE signal', () => {
    const bus = new Bus(tempBusPath(), 's1');
    expect(latestPhase(bus.readAll())).toBeNull();
    bus.write('PHASE', '1/9|env|Environment gate', 'qa-lead');
    bus.write('BUG-FILED', '#1 x', 'qa-hawk');
    bus.write('PHASE', '2/9|plan|Test plan', 'qa-lead');
    expect(latestPhase(bus.readAll())).toMatchObject({ index: 2, id: 'plan' });
  });

  it('readAll sees lines appended by another writer after a first read', () => {
    const path = tempBusPath();
    const reader = new Bus(path, 'shared');
    const writer = new Bus(path, 'shared');
    reader.write('META', 'ctx', 'qa-lead');
    expect(reader.readAll()).toHaveLength(1);
    writer.write('DONE', 'qa-hawk', 'qa-hawk');
    expect(reader.readAll().map((s) => s.type)).toEqual(['META', 'DONE']);
  });

  it('readAll serves repeat reads from cache without re-parsing the whole file', () => {
    const path = tempBusPath();
    const bus = new Bus(path, 's1');
    for (let i = 0; i < 100; i++) bus.write('PROGRESS', `step ${i}`, 'qa-hawk');

    const parseSpy = vi.spyOn(Bus, 'parse');
    expect(bus.readAll()).toHaveLength(100);
    const parsesFirstRead = parseSpy.mock.calls.length; // ≤ 100 lines + blanks
    expect(bus.readAll()).toHaveLength(100); // nothing appended since
    expect(parseSpy.mock.calls.length).toBe(parsesFirstRead); // zero new parses
    parseSpy.mockRestore();
  });

  it('readAll recovers when the file is truncated/replaced externally', () => {
    const path = tempBusPath();
    const bus = new Bus(path, 's1');
    bus.write('META', 'old', 'qa-lead');
    expect(bus.readAll()).toHaveLength(1);
    // simulate an external reset (e.g. a fresh checkout / manual clean)
    writeFileSync(path, '');
    expect(bus.readAll()).toHaveLength(0);
    bus.write('META', 'new', 'qa-lead');
    expect(bus.readAll().map((s) => s.payload)).toEqual(['new']);
  });

  it('emits a signal event on write', () => {
    const bus = new Bus(tempBusPath(), 's1');
    const seen: string[] = [];
    bus.on('signal', (s) => seen.push(`${s.type}:${s.payload}`));
    bus.write('TC-READY', 'auth', 'qa-tc-writer');
    expect(seen).toEqual(['TC-READY:auth']);
  });
});
