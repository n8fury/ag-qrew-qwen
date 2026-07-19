import { describe, expect, it } from 'vitest';
import { applyLoopGuard, closeUnterminated, escapeControlCharsInStrings, parseToolArgs } from '../agentLoop.js';

describe('parseToolArgs', () => {
  it('parses plain valid JSON', () => {
    expect(parseToolArgs('{"path":"a.txt","content":"hi"}')).toEqual({ args: { path: 'a.txt', content: 'hi' } });
  });

  it('treats empty/missing arguments as {}', () => {
    expect(parseToolArgs('')).toEqual({ args: {} });
    expect(parseToolArgs(undefined)).toEqual({ args: {} });
    expect(parseToolArgs('   ')).toEqual({ args: {} });
  });

  it('strips markdown fences', () => {
    expect(parseToolArgs('```json\n{"a":1}\n```')).toEqual({ args: { a: 1 } });
  });

  it('repairs raw newlines inside string literals', () => {
    const raw = '{"content":"line one\nline two"}';
    expect(parseToolArgs(raw)).toEqual({ args: { content: 'line one\nline two' } });
  });

  it('repairs trailing commas', () => {
    expect(parseToolArgs('{"a":1,}')).toEqual({ args: { a: 1 } });
    expect(parseToolArgs('{"a":[1,2,],}')).toEqual({ args: { a: [1, 2] } });
  });

  it('repairs a payload cut off mid-string (model ran out of output budget)', () => {
    const truncated = '{"module":"tasks","cases":[{"title":"Verify that crea';
    const parsed = parseToolArgs(truncated);
    expect(parsed).not.toBeNull();
    expect(parsed!.args.module).toBe('tasks');
    expect(Array.isArray(parsed!.args.cases)).toBe(true);
  });

  it('returns null for unrepairable garbage', () => {
    expect(parseToolArgs('not json at all }{')).toBeNull();
  });
});

describe('closeUnterminated', () => {
  it('closes an unterminated string and open braces', () => {
    expect(JSON.parse(closeUnterminated('{"a":"unfinished'))).toEqual({ a: 'unfinished' });
  });

  it('closes nested open brackets in order', () => {
    expect(JSON.parse(closeUnterminated('{"a":[{"b":1'))).toEqual({ a: [{ b: 1 }] });
  });

  it('leaves already-valid JSON untouched', () => {
    expect(closeUnterminated('{"a":1}')).toBe('{"a":1}');
  });
});

describe('escapeControlCharsInStrings', () => {
  it('escapes newline/CR/tab inside strings only', () => {
    const out = escapeControlCharsInStrings('{"a":"x\ny\tz"}');
    expect(JSON.parse(out)).toEqual({ a: 'x\ny\tz' });
  });

  it('does not touch structural whitespace outside strings', () => {
    const out = escapeControlCharsInStrings('{\n  "a": 1\n}');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('respects escaped quotes inside strings', () => {
    const out = escapeControlCharsInStrings('{"a":"he said \\"hi\\"\nbye"}');
    expect(JSON.parse(out)).toEqual({ a: 'he said "hi"\nbye' });
  });

  it('escapes all other raw control chars (\\b, \\f, …) inside strings', () => {
    const parsed = parseToolArgs('{"a":"x\by\fz\x01w"}');
    expect(parsed).toEqual({ args: { a: 'x\by\fz\x01w' } });
  });
});

describe('applyLoopGuard', () => {
  const result = 'HTTP 200 OK';
  const jsonError = 'ERROR: the arguments of your http_request call were not valid JSON';

  it('leaves the first two identical results untouched', () => {
    expect(applyLoopGuard('http_request', result, true, 1)).toBe(result);
    expect(applyLoopGuard('http_request', result, true, 2)).toBe(result);
  });

  it('appends the repeat nudge at 3-4 identical parsed calls', () => {
    const out = applyLoopGuard('http_request', result, true, 3);
    expect(out).toContain(result); // result still delivered
    expect(out).toMatch(/EXACT call 3 times/);
  });

  it('withholds the result at 5 identical parsed calls', () => {
    const out = applyLoopGuard('http_request', result, true, 5);
    expect(out).not.toContain(result);
    expect(out).toMatch(/WITHHELD/);
    expect(out).toMatch(/DIFFERENT call/);
  });

  it('gives bad-JSON repeats their own wording at 3-4', () => {
    const out = applyLoopGuard('http_request', jsonError, false, 3);
    expect(out).toContain(jsonError);
    expect(out).toMatch(/malformed-JSON failure #3/);
    expect(out).toMatch(/NEVER contacted/);
  });

  it('hard-stops bad-JSON loops at 5 too (previously shadowed forever)', () => {
    // 5 identical unparseable payloads: the first four escalate softly, the
    // fifth must reach the hard stop instead of repeating the soft nudge.
    const seen = [1, 2, 3, 4, 5].map((n) => applyLoopGuard('http_request', jsonError, false, n));
    expect(seen[3]).toMatch(/malformed-JSON failure #4/);
    expect(seen[4]).toMatch(/WITHHELD/);
    expect(seen[4]).toMatch(/SKIPPED/);
    expect(seen[4]).not.toContain(jsonError);
  });
});
