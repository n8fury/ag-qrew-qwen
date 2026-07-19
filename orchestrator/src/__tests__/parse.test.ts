import { describe, expect, it } from 'vitest';
import { closeUnterminated, escapeControlCharsInStrings, parseToolArgs } from '../agentLoop.js';

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
});
