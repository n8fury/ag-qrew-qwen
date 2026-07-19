/**
 * Input-availability model (plan-general-inputs Phase A). A run is described by
 * which of the three inputs exist — target URL, requirements doc, OpenAPI spec —
 * and `detectMode` maps every subset to what the pipeline can honestly deliver.
 *
 * SINGLE SOURCE OF TRUTH: this function drives the /api/preview endpoint, the
 * orchestrator's phase skipping, the verdict logic, and (via the API) the
 * dashboard's capability card. The matrix must never exist anywhere else.
 */

/**
 * The fixed pipeline segments the dashboard progress bar renders. One PHASE
 * signal marks the START of each; the conditional 2d cross-check folds into
 * `api` so the total never changes mid-run (a bar with a moving total reads
 * as a bug). Mirrored client-side in dashboard/src/components/ProgressBar.tsx.
 */
export const PHASES = [
  { id: 'env', label: 'Environment gate' },
  { id: 'plan', label: 'Test plan' },
  { id: 'approval', label: 'Approval checkpoint' },
  { id: 'cases', label: 'Test cases' },
  { id: 'scripts', label: 'E2E scripts' },
  { id: 'explore', label: 'Exploratory' },
  { id: 'api', label: 'API tests' },
  { id: 'adjudicate', label: 'Adjudication' },
  { id: 'signoff', label: 'Sign-off' },
] as const;
export type PhaseId = (typeof PHASES)[number]['id'];

export interface ModeInputs {
  site?: string | undefined;
  docText?: string | undefined;
  /** an OpenAPI spec is present (uploaded or bundled) */
  spec?: boolean | undefined;
}

export type ModeId =
  | 'full' | 'execution' | 'contract-explore' | 'explore'
  | 'design-contract' | 'design' | 'contract-design';

export interface RunMode {
  modeId: ModeId;
  label: string;
  phases: PhaseId[];
  detected: { site: boolean; docText: boolean; spec: boolean };
  willDo: string[];
  wontDo: string[];
  /** what one more input would enable — non-empty for every mode except `full` */
  unlocks: string[];
}

export class NoInputsError extends Error {
  constructor() {
    super('at least one input is required: a target URL, a requirements document, or an OpenAPI spec');
  }
}

const DESIGN_PHASES: PhaseId[] = ['plan', 'approval', 'cases', 'signoff'];
const EXEC_NO_API: PhaseId[] = ['env', 'plan', 'approval', 'cases', 'scripts', 'explore', 'adjudicate', 'signoff'];
const ALL: PhaseId[] = PHASES.map((p) => p.id);

const UNLOCK = {
  site: 'add a target URL to unlock execution: environment gate, E2E scripts, exploratory testing',
  doc: 'add a requirements document to give the agents real claims to test against (stronger oracles, better cases)',
  spec: 'add an OpenAPI spec to unlock the API contract battery and the fabricated-endpoint guard',
};

/** True when the run executes against a live site (vs design-only). */
export function isExecutionMode(modeId: ModeId): boolean {
  return modeId === 'full' || modeId === 'execution' || modeId === 'contract-explore' || modeId === 'explore';
}

/** The slice of a RunMode the dashboard progress bar needs from /api/state (C.3). */
export interface ModeState { modeId: ModeId; label: string; phases: PhaseId[]; }

/**
 * Project a RunMode down to what /api/state serves — or null when no run is
 * active (server just (re)started). A null mode means the bar falls back to the
 * all-active (all-9-segments) rendering, since the mode was never persisted.
 */
export function modeState(m: RunMode | null): ModeState | null {
  return m ? { modeId: m.modeId, label: m.label, phases: m.phases } : null;
}

export function detectMode(inputs: ModeInputs): RunMode {
  const site = Boolean(inputs.site);
  const doc = Boolean(inputs.docText);
  const spec = Boolean(inputs.spec);
  const detected = { site, docText: doc, spec };
  if (!site && !doc && !spec) throw new NoInputsError();

  if (site && doc && spec) {
    return {
      modeId: 'full', label: 'Full pipeline', phases: ALL, detected,
      willDo: ['test plan from the requirements', 'structured test cases', 'DOM-grounded E2E scripts, executed',
               'exploratory testing with screenshot evidence', 'API contract battery against the spec',
               'dispute adjudication', 'sign-off verdict'],
      wontDo: [],
      unlocks: [],
    };
  }
  if (site && doc) {
    return {
      modeId: 'execution', label: 'Execution (no API contract)', phases: EXEC_NO_API, detected,
      willDo: ['test plan from the requirements', 'structured test cases', 'DOM-grounded E2E scripts, executed',
               'exploratory testing with screenshot evidence', 'dispute adjudication', 'sign-off verdict'],
      wontDo: ['no API contract verdicts (no spec — the fabricated-endpoint guard is disabled)'],
      unlocks: [UNLOCK.spec],
    };
  }
  if (site && spec) {
    return {
      modeId: 'contract-explore', label: 'Contract + exploratory', phases: ALL, detected,
      willDo: ['test plan derived from the spec', 'structured test cases', 'DOM-grounded E2E scripts, executed',
               'exploratory testing with screenshot evidence', 'API contract battery against the spec',
               'dispute adjudication', 'sign-off verdict'],
      wontDo: ['no business-requirement oracles — claims come from the spec only'],
      unlocks: [UNLOCK.doc],
    };
  }
  if (site) {
    return {
      modeId: 'explore', label: 'Exploratory only', phases: EXEC_NO_API, detected,
      willDo: ['light test plan from exploration', 'test cases for discovered flows',
               'DOM-grounded E2E smoke scripts, executed', 'exploratory testing with screenshot evidence',
               'dispute adjudication', 'sign-off verdict'],
      wontDo: ['weak oracles — no requirements and no spec, so only consistency heuristics apply',
               'no API contract verdicts'],
      unlocks: [UNLOCK.doc, UNLOCK.spec],
    };
  }
  if (doc && spec) {
    return {
      modeId: 'design-contract', label: 'Design + API cases (no execution)', phases: DESIGN_PHASES, detected,
      willDo: ['test plan from the requirements', 'structured test cases including API contract cases', 'design sign-off'],
      wontDo: ['no execution of any kind — nothing to run against'],
      unlocks: [UNLOCK.site],
    };
  }
  if (doc) {
    return {
      modeId: 'design', label: 'Design only', phases: DESIGN_PHASES, detected,
      willDo: ['test plan from the requirements', 'structured test cases', 'design sign-off'],
      wontDo: ['no execution of any kind — nothing to run against', 'no API contract cases (no spec)'],
      unlocks: [UNLOCK.site, UNLOCK.spec],
    };
  }
  // spec only
  return {
    modeId: 'contract-design', label: 'API contract cases (no execution)', phases: DESIGN_PHASES, detected,
    willDo: ['test plan derived from the spec', 'API contract test cases', 'design sign-off'],
    wontDo: ['no execution of any kind — nothing to run against', 'no UI cases — the spec describes no UI'],
    unlocks: [UNLOCK.site, UNLOCK.doc],
  };
}
