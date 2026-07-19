import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSpecPaths, pathMatches, undocumentedEndpointCited } from '../tools/store.js';

const DEMO_SPEC = fileURLToPath(new URL('../../../demo-app/openapi.yaml', import.meta.url));
const specText = readFileSync(DEMO_SPEC, 'utf8');

/** qaRoot with the real demo spec installed as qa/openapi.yaml. */
function qaRootWithSpec(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agqrew-spec-'));
  writeFileSync(join(dir, 'openapi.yaml'), specText);
  return dir;
}

const bug = (over: Partial<{ title: string; oracle: string; steps: string }>) => ({
  title: 'a bug', oracle: 'Claims', steps: '1. do the thing', ...over,
});

describe('parseSpecPaths', () => {
  it('extracts every documented (path, method) pair from the real demo spec', () => {
    const spec = parseSpecPaths(specText);
    expect(spec.get('/api/auth/login')).toEqual(new Set(['POST']));
    expect(spec.get('/api/tasks')).toEqual(new Set(['GET', 'POST']));
    expect(spec.get('/api/tasks/{id}')).toEqual(new Set(['PUT', 'DELETE']));
    expect(spec.size).toBe(3);
  });

  it('returns an empty map when there is no paths section', () => {
    expect(parseSpecPaths('openapi: 3.0.0\ninfo:\n  title: x\n').size).toBe(0);
  });
});

describe('pathMatches', () => {
  it('matches literal paths and {param} wildcards', () => {
    expect(pathMatches('/api/tasks', '/api/tasks')).toBe(true);
    expect(pathMatches('/api/tasks/{id}', '/api/tasks/{id}')).toBe(true);
    expect(pathMatches('/api/tasks/{id}', '/api/tasks/comments')).toBe(true); // any single segment
    expect(pathMatches('/api/tasks', '/api/users')).toBe(false);
    expect(pathMatches('/api/tasks/{id}', '/api/tasks')).toBe(false); // length differs
  });
});

describe('undocumentedEndpointCited', () => {
  it('accepts a bug citing a documented pair', () => {
    const err = undocumentedEndpointCited(
      bug({ steps: '1. POST /api/tasks with {} and a valid token\n2. observe 200' }),
      qaRootWithSpec(),
    );
    expect(err).toBeNull();
  });

  it('normalises numeric ids to {id} before matching', () => {
    const err = undocumentedEndpointCited(
      bug({ steps: '1. DELETE http://localhost:3000/api/tasks/7' }),
      qaRootWithSpec(),
    );
    expect(err).toBeNull();
  });

  it('rejects a bug citing a fabricated endpoint', () => {
    const err = undocumentedEndpointCited(bug({ steps: '1. GET /api/users' }), qaRootWithSpec());
    expect(err).toMatch(/NOT filed/);
    expect(err).toMatch(/GET \/api\/users/);
  });

  it('rejects a documented path used with an undocumented method', () => {
    const err = undocumentedEndpointCited(bug({ steps: '1. PATCH /api/tasks/3' }), qaRootWithSpec());
    expect(err).toMatch(/NOT filed/);
  });

  it('is a no-op when no spec exists in qaRoot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agqrew-nospec-'));
    expect(undocumentedEndpointCited(bug({ steps: '1. GET /api/users' }), dir)).toBeNull();
  });
});
