import { afterEach, describe, expect, it } from 'vitest';
import { optNumber } from '../config.js';

const KEY = 'AGQREW_TEST_NUMBER';

describe('optNumber', () => {
  afterEach(() => { delete process.env[KEY]; });

  it('returns the fallback when the env var is unset or empty', () => {
    expect(optNumber(KEY, 25)).toBe(25);
    process.env[KEY] = '';
    expect(optNumber(KEY, 25)).toBe(25);
  });

  it('parses a valid positive number', () => {
    process.env[KEY] = '150000';
    expect(optNumber(KEY, 25)).toBe(150000);
  });

  it('throws on a malformed value instead of silently yielding NaN', () => {
    process.env[KEY] = '150k';
    expect(() => optNumber(KEY, 25)).toThrow(/must be a positive number.*"150k"/);
  });

  it('throws on zero and negative values', () => {
    process.env[KEY] = '0';
    expect(() => optNumber(KEY, 25)).toThrow(/positive number/);
    process.env[KEY] = '-5';
    expect(() => optNumber(KEY, 25)).toThrow(/positive number/);
  });
});
