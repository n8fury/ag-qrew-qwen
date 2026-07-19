import { afterEach, describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { acceptSpecYaml, deniedHost, tokenGuard, validateRunContext } from '../security.js';

const goodCtx = {
  project: 'Demo Task Manager', sprint: 1, site: 'http://localhost:3000',
  modules: ['auth', 'tasks'],
  creds: { adminEmail: 'admin@demo.test', adminPassword: 'admin123' },
  docText: 'Sprint 1 — login + task CRUD.',
  siteMap: 'login = / · tasks = /tasks',
};

describe('validateRunContext', () => {
  it('accepts a well-formed ctx', () => {
    const v = validateRunContext(goodCtx);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.ctx.site).toBe('http://localhost:3000');
  });

  it('strips unknown keys', () => {
    const v = validateRunContext({ ...goodCtx, __proto__pollution: 'x', extra: 1 });
    expect(v.ok).toBe(true);
    if (v.ok) expect('extra' in (v.ctx as object)).toBe(false);
  });

  it('rejects a non-http(s) site URL', () => {
    const v = validateRunContext({ ...goodCtx, site: 'file:///etc/passwd' });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.error).toMatch(/http\(s\)/);
  });

  it('rejects a cloud-metadata site host', () => {
    const v = validateRunContext({ ...goodCtx, site: 'http://169.254.169.254/latest/meta-data' });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.error).toMatch(/not allowed/);

    const g = validateRunContext({ ...goodCtx, site: 'http://metadata.google.internal/computeMetadata' });
    expect(g.ok).toBe(false);
  });

  it('rejects a malformed shape (missing modules / empty docText)', () => {
    expect(validateRunContext({ ...goodCtx, modules: [] }).ok).toBe(false);
    expect(validateRunContext({ ...goodCtx, docText: '' }).ok).toBe(false);
    expect(validateRunContext('not an object').ok).toBe(false);
  });

  it('accepts any single input: site-only, doc-only, or spec-only', () => {
    const base = { project: 'P', sprint: 1, modules: ['m'] };
    expect(validateRunContext({ ...base, site: 'http://localhost:3000' }).ok).toBe(true);
    expect(validateRunContext({ ...base, docText: 'requirements' }).ok).toBe(true);
    expect(validateRunContext(base, true).ok).toBe(true); // spec provided out-of-band
  });

  it('rejects a ctx with no inputs at all, naming the three accepted sources', () => {
    const v = validateRunContext({ project: 'P', sprint: 1, modules: ['m'] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error).toMatch(/target URL.*requirements.*OpenAPI spec/);
      expect(v.fieldErrors.ctx).toMatch(/target URL/); // field-level for the dashboard
    }
  });

  it('reports field-level errors keyed by path (for inline dashboard display)', () => {
    const v = validateRunContext({ ...goodCtx, site: 'file:///etc/passwd', modules: [] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.fieldErrors.site).toMatch(/http\(s\)/);
      expect(v.fieldErrors.modules).toBeTruthy();
    }
  });

  it('accepts the new appNotes and priorityOracles fields (bounded)', () => {
    const v = validateRunContext({
      ...goodCtx,
      appNotes: 'login lands on /home',
      priorityOracles: { api: 'POST /x → 400', explore: 'check the header count' },
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.ctx.priorityOracles?.api).toBe('POST /x → 400');
    expect(validateRunContext({ ...goodCtx, appNotes: 'x'.repeat(10_001) }).ok).toBe(false);
  });
});

describe('acceptSpecYaml (uploaded OpenAPI spec gate — Phase C.2)', () => {
  const VALID_SPEC = `openapi: 3.0.0
info:
  title: Demo Task Manager
  version: 1.0.0
paths:
  /api/tasks:
    get:
      responses:
        '200':
          description: ok
    post:
      responses:
        '400':
          description: bad
`;

  it('accepts a block-style spec that documents at least one path', () => {
    const r = acceptSpecYaml(VALID_SPEC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(VALID_SPEC);
  });

  it('rejects a non-string or empty body', () => {
    expect(acceptSpecYaml(undefined).ok).toBe(false);
    expect(acceptSpecYaml(123).ok).toBe(false);
    expect(acceptSpecYaml('   ').ok).toBe(false);
  });

  it('rejects garbage and empty-paths YAML (no documented paths)', () => {
    const garbage = acceptSpecYaml('this is not a spec {{{ nonsense');
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.error).toMatch(/no paths/i);

    const emptyPaths = acceptSpecYaml('openapi: 3.0.0\ninfo:\n  title: X\n  version: 1.0.0\npaths:\n');
    expect(emptyPaths.ok).toBe(false);
  });

  it('rejects a spec over the 1 MB limit', () => {
    const huge = VALID_SPEC + '\n' + '#'.repeat(1_000_001); // valid head, >1 MB total
    const r = acceptSpecYaml(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 MB/);
  });
});

describe('deniedHost', () => {
  it('flags the whole 169.254.0.0/16 range and metadata hostnames', () => {
    expect(deniedHost('169.254.169.254')).toBeTruthy();
    expect(deniedHost('169.254.1.1')).toBeTruthy();
    expect(deniedHost('metadata.google.internal')).toBeTruthy();
    expect(deniedHost('localhost')).toBeNull();
    expect(deniedHost('demo-app')).toBeNull();
    expect(deniedHost('example.com')).toBeNull();
  });
});

describe('tokenGuard', () => {
  afterEach(() => { delete process.env.AGQREW_TOKEN; });

  function call(headers: Record<string, string | undefined>) {
    let status: number | null = null;
    let nextCalled = false;
    const req = { headers } as unknown as Request;
    const res = {
      status(code: number) { status = code; return this; },
      json() { return this; },
    } as unknown as Response;
    tokenGuard(req, res, (() => { nextCalled = true; }) as NextFunction);
    return { status, nextCalled };
  }

  it('is a no-op when AGQREW_TOKEN is unset', () => {
    expect(call({})).toEqual({ status: null, nextCalled: true });
  });

  it('rejects requests without the token when set', () => {
    process.env.AGQREW_TOKEN = 's3cret';
    expect(call({})).toEqual({ status: 401, nextCalled: false });
    expect(call({ authorization: 'Bearer wrong' })).toEqual({ status: 401, nextCalled: false });
  });

  it('accepts the token via Authorization: Bearer or X-AGQREW-TOKEN', () => {
    process.env.AGQREW_TOKEN = 's3cret';
    expect(call({ authorization: 'Bearer s3cret' })).toEqual({ status: null, nextCalled: true });
    expect(call({ 'x-agqrew-token': 's3cret' })).toEqual({ status: null, nextCalled: true });
  });
});
