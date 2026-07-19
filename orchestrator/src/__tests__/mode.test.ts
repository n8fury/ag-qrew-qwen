import { describe, expect, it } from 'vitest';
import { detectMode, isExecutionMode, NoInputsError, PHASES } from '../mode.js';

const SITE = 'http://localhost:3000';
const DOC = 'Sprint 1 — release notes.';
const PHASE_IDS = new Set(PHASES.map((p) => p.id));

describe('detectMode — the full input matrix', () => {
  const rows = [
    { inputs: { site: SITE, docText: DOC, spec: true }, modeId: 'full', phaseCount: 9 },
    { inputs: { site: SITE, docText: DOC, spec: false }, modeId: 'execution', phaseCount: 8 },
    { inputs: { site: SITE, spec: true }, modeId: 'contract-explore', phaseCount: 9 },
    { inputs: { site: SITE }, modeId: 'explore', phaseCount: 8 },
    { inputs: { docText: DOC, spec: true }, modeId: 'design-contract', phaseCount: 4 },
    { inputs: { docText: DOC }, modeId: 'design', phaseCount: 4 },
    { inputs: { spec: true }, modeId: 'contract-design', phaseCount: 4 },
  ] as const;

  it.each(rows)('$modeId from site=$inputs.site doc-present spec=$inputs.spec', ({ inputs, modeId, phaseCount }) => {
    const m = detectMode(inputs);
    expect(m.modeId).toBe(modeId);
    expect(m.phases).toHaveLength(phaseCount);
    // every phase id is a real pipeline segment, in pipeline order
    expect(m.phases.every((p) => PHASE_IDS.has(p))).toBe(true);
    const order = PHASES.map((p) => p.id as string);
    const idxs = m.phases.map((p) => order.indexOf(p));
    expect([...idxs].sort((a, b) => a - b)).toEqual(idxs);
    // full mode has nothing to unlock; every other mode must hint at more
    if (modeId === 'full') {
      expect(m.unlocks).toHaveLength(0);
      expect(m.wontDo).toHaveLength(0);
    } else {
      expect(m.unlocks.length).toBeGreaterThan(0);
      expect(m.wontDo.length).toBeGreaterThan(0);
    }
    expect(m.willDo.length).toBeGreaterThan(0);
  });

  it('rejects the empty input set with a message naming all three inputs', () => {
    expect(() => detectMode({})).toThrow(NoInputsError);
    expect(() => detectMode({ site: '', docText: '', spec: false })).toThrow(/target URL.*requirements.*OpenAPI/);
  });

  it('design modes run no execution phases', () => {
    for (const m of [detectMode({ docText: DOC }), detectMode({ spec: true }), detectMode({ docText: DOC, spec: true })]) {
      expect(isExecutionMode(m.modeId)).toBe(false);
      expect(m.phases).toEqual(['plan', 'approval', 'cases', 'signoff']);
    }
  });

  it('execution modes always include the env gate; spec gates the api phase', () => {
    for (const inputs of [{ site: SITE, docText: DOC, spec: true }, { site: SITE }] as const) {
      const m = detectMode(inputs);
      expect(isExecutionMode(m.modeId)).toBe(true);
      expect(m.phases[0]).toBe('env');
      expect(m.phases.includes('api')).toBe(Boolean(inputs.spec));
    }
  });
});
