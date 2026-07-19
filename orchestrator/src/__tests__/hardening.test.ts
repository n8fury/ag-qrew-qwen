import OpenAI from 'openai';
import { afterEach, describe, expect, it } from 'vitest';
import { checkUrlPolicy } from '../tools/http.js';
import { pngTooLargeError } from '../tools/playwright.js';
import { isRetriable } from '../qwen.js';

describe('checkUrlPolicy (http_request)', () => {
  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.HTTP_ALLOW_HOSTS;
  });

  it('allows the configured demo-app host (default target)', () => {
    expect(checkUrlPolicy('http://localhost:3000/api/tasks')).toBeNull();
  });

  it('allows the run target from SITE_URL, any port/path', () => {
    process.env.SITE_URL = 'http://demo-app:3000';
    expect(checkUrlPolicy('http://demo-app:3000/api/auth/login')).toBeNull();
  });

  it('treats loopback aliases as one target', () => {
    // task says localhost, agent writes 127.0.0.1 — same app under test
    expect(checkUrlPolicy('http://127.0.0.1:3000/api/tasks')).toBeNull();
    expect(checkUrlPolicy('http://[::1]:3000/api/tasks')).toBeNull();
  });

  it('always denies link-local / metadata hosts', () => {
    const err = checkUrlPolicy('http://169.254.169.254/latest/meta-data');
    expect(err).toMatch(/blocked by policy/);
    // even when explicitly allowlisted
    process.env.HTTP_ALLOW_HOSTS = '169.254.169.254,metadata.google.internal';
    expect(checkUrlPolicy('http://169.254.169.254/latest/meta-data')).toMatch(/blocked by policy/);
    expect(checkUrlPolicy('http://metadata.google.internal/computeMetadata')).toMatch(/blocked by policy/);
  });

  it('denies off-target hosts with an explanatory message', () => {
    const err = checkUrlPolicy('https://example.com/anything');
    expect(err).toMatch(/not the app under test/);
    expect(err).toMatch(/localhost/); // lists what IS allowed
  });

  it('HTTP_ALLOW_HOSTS extends the allowlist', () => {
    process.env.HTTP_ALLOW_HOSTS = 'staging.example.com, other.example.org';
    expect(checkUrlPolicy('https://staging.example.com/api/x')).toBeNull();
    expect(checkUrlPolicy('https://other.example.org/健康')).toBeNull();
    expect(checkUrlPolicy('https://evil.example.net/')).toMatch(/not the app under test/);
  });

  it('rejects malformed and non-http URLs', () => {
    expect(checkUrlPolicy('/api/tasks')).toMatch(/not a valid absolute URL/);
    expect(checkUrlPolicy('ftp://localhost/x')).toMatch(/only http\(s\)/);
    expect(checkUrlPolicy('file:///etc/passwd')).toMatch(/only http\(s\)/);
  });
});

describe('pngTooLargeError (browser_snapshot)', () => {
  it('passes normal screenshots through', () => {
    expect(pngTooLargeError(200 * 1024, 'qa/screenshots/snap-001.png')).toBeNull();
  });

  it('refuses to send an oversized PNG to the vision model but keeps the evidence', () => {
    const err = pngTooLargeError(6 * 1024 * 1024, 'qa/screenshots/snap-002.png');
    expect(err).toMatch(/snap-002\.png/); // saved path still cited
    expect(err).toMatch(/exceeds the 5 MB limit/);
  });
});

describe('isRetriable (qwen client)', () => {
  it('retries 429 and 5xx', () => {
    expect(isRetriable({ status: 429 })).toBe(true);
    expect(isRetriable({ status: 500 })).toBe(true);
    expect(isRetriable({ response: { status: 503 } })).toBe(true);
  });

  it('fails fast on 4xx auth/validation', () => {
    expect(isRetriable({ status: 400 })).toBe(false);
    expect(isRetriable({ status: 401 })).toBe(false);
    expect(isRetriable({ status: 403 })).toBe(false); // model-access denial: never heals
  });

  it('retries genuine connection errors', () => {
    const err = new OpenAI.APIConnectionError({ message: 'socket hang up' });
    expect(isRetriable(err)).toBe(true);
  });

  it('surfaces local programming errors immediately (no status ≠ transient)', () => {
    expect(isRetriable(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isRetriable(new Error('random'))).toBe(false);
  });
});
