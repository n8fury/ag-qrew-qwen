import { describe, expect, it } from 'vitest';
import { apiTesterTask, hawkExploreTask, scriptWriterTask, testPlanTask, type RunContext } from '../agents/worker.js';
import { demoContext } from '../demoPreset.js';

/**
 * Task-builder generalization (plan-general-inputs A.1): the demo's oracles ride
 * in ctx fields, so the DEMO preset must still produce its tuned prompts while a
 * GENERIC target gets prompts free of any demo-specific text.
 */

const demo = demoContext('http://localhost:3000');

const generic: RunContext = {
  project: 'Acme Shop', sprint: 2, site: 'http://shop.example.test',
  modules: ['catalog', 'checkout'],
  docText: 'Users can browse products and add them to a cart.',
};

// Strings that only make sense for the Demo Task Manager.
const DEMO_MARKERS = ['/api/tasks', '/tasks', 'forgot-password', 'Tasks (', '201-character', 'DELETE staleness'];

describe('demo preset prompts (must stay equivalent to the tuned originals)', () => {
  it('api-tester keeps its priority checks', () => {
    const t = apiTesterTask(demo);
    expect(t).toContain('PRIORITY CHECKS');
    expect(t).toContain('201-character title');
    expect(t).toContain('no Authorization header — expect 401');
  });

  it('hawk keeps both exploratory oracles and the per-oracle contract', () => {
    const t = hawkExploreTask(demo);
    expect(t).toContain('PRIORITY ORACLES');
    expect(t).toContain('DELETE staleness');
    expect(t).toContain('"Tasks (3)"');
    expect(t).toContain('EVERY priority oracle above');
  });

  it('script-writer keeps the app notes (redirect + absent features)', () => {
    const t = scriptWriterTask(demo, '');
    expect(t).toContain('APP NOTES');
    expect(t).toContain("waitForURL('**/tasks')");
    expect(t).toContain('forgot-password');
  });
});

describe('generic target prompts (no demo leakage)', () => {
  it.each([
    ['apiTesterTask', () => apiTesterTask(generic)],
    ['hawkExploreTask', () => hawkExploreTask(generic)],
    ['scriptWriterTask', () => scriptWriterTask(generic, '')],
  ])('%s contains no demo-specific text', (_name, build) => {
    const t = build();
    for (const marker of DEMO_MARKERS) {
      expect(t, `should not contain "${marker}"`).not.toContain(marker);
    }
  });

  it('hawk still gets a deliverable contract without oracles', () => {
    expect(hawkExploreTask(generic)).toContain('DELIVERABLE CONTRACT');
  });

  it('builders tolerate a missing site and docText', () => {
    const minimal: RunContext = { project: 'Doc Only', sprint: 1, modules: ['auth'] };
    expect(testPlanTask(minimal)).toContain('no requirements document provided');
    expect(testPlanTask(minimal)).toContain('no target URL');
    expect(() => apiTesterTask(minimal)).not.toThrow();
    expect(() => hawkExploreTask(minimal)).not.toThrow();
    expect(() => scriptWriterTask(minimal, '')).not.toThrow();
  });
});
