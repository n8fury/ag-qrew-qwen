import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSandboxed } from '../tools/fs.js';
import { assertInsideQa } from '../tools/playwright.js';

const qaRoot = mkdtempSync(join(tmpdir(), 'agqrew-sandbox-'));

// Both resolvers implement the same contract — test them against the same table.
const resolvers = [
  ['resolveSandboxed (fs)', resolveSandboxed],
  ['assertInsideQa (playwright)', assertInsideQa],
] as const;

describe.each(resolvers)('%s', (_name, fn) => {
  it('accepts a bare relative path', () => {
    expect(fn(qaRoot, 'specs/login.spec.ts')).toBe(resolve(qaRoot, 'specs', 'login.spec.ts'));
  });

  it('accepts the qa/-prefixed form agents use', () => {
    expect(fn(qaRoot, 'qa/specs/login.spec.ts')).toBe(resolve(qaRoot, 'specs', 'login.spec.ts'));
  });

  it('accepts the qa root itself', () => {
    expect(fn(qaRoot, 'qa/')).toBe(resolve(qaRoot));
  });

  it('rejects ../ escapes', () => {
    expect(() => fn(qaRoot, '../outside.txt')).toThrow(/escapes the qa\/ sandbox/);
    expect(() => fn(qaRoot, 'specs/../../outside.txt')).toThrow(/escapes the qa\/ sandbox/);
  });

  it('rejects Windows-style ..\\ escapes', () => {
    expect(() => fn(qaRoot, '..\\..\\etc\\hosts')).toThrow(/escapes the qa\/ sandbox/);
  });

  it('rejects absolute paths outside the root', () => {
    const outside = resolve(qaRoot, '..') + sep + 'elsewhere.txt';
    expect(() => fn(qaRoot, outside)).toThrow(/escapes the qa\/ sandbox/);
  });

  it('rejects a sibling directory whose name shares the root prefix', () => {
    // e.g. root "/tmp/qa" must not admit "/tmp/qa-evil/x"
    expect(() => fn(qaRoot, `${qaRoot}-evil${sep}x.txt`)).toThrow(/escapes the qa\/ sandbox/);
  });
});
