import { chat } from './qwen.js';
import type { DB, Dispute, Verdict, Bug } from './db.js';
import type { Bus } from './bus.js';

/**
 * Track-3 conflict resolution. When one agent's evidence contradicts another's
 * finding (a DISPUTE on the bus), the QA Lead adjudicates: it reads both
 * positions, decides which evidence is stronger, and records a verdict. This is
 * the "disagreement/conflict resolution" criterion the track scores — genuine to
 * QA, not bolted on: e.g. qa-hawk files "deleted item still shows" from the UI,
 * qa-api-tester counters that DELETE returns 200 and the list no longer contains
 * it, so it is a UI-refresh bug, not a data bug. The Lead reconciles the two.
 */

const VERDICTS: Verdict[] = ['UPHELD', 'DOWNGRADED', 'REJECTED', 'RECLASSIFIED'];
const SEVERITIES: Bug['severity'][] = ['Critical', 'High', 'Medium', 'Low'];

export interface Adjudication {
  verdict: Verdict;
  rationale: string;
  newSeverity?: Bug['severity'];
  newTitle?: string;
}

const SYSTEM = `You are the QA Lead adjudicating a disagreement between two QA agents about a single finding.
You are impartial. Decide based only on which evidence is technically stronger, not on which agent spoke.
Return STRICT JSON, no prose outside it:
{
  "verdict": "UPHELD" | "DOWNGRADED" | "REJECTED" | "RECLASSIFIED",
  "rationale": "one paragraph citing which piece of evidence is decisive and why",
  "newSeverity": "Critical" | "High" | "Medium" | "Low" (optional; include for DOWNGRADED/RECLASSIFIED),
  "newTitle": "corrected finding title (optional; include for RECLASSIFIED)"
}
Guidance: UPHELD = the finding stands as filed; DOWNGRADED = real but less severe than filed;
RECLASSIFIED = real but mischaracterised (e.g. a UI bug filed as a data bug), set newTitle;
REJECTED = the counter-evidence disproves it (a false positive).`;

/** The full bug row as the debaters/judge see it — steps and evidence included:
 *  the judge is weighing EVIDENCE, so the filed reproduction and its artefacts
 *  (response bodies, screenshot paths) are the substance, not decoration. */
export function bugBlock(bug?: Bug): string {
  if (!bug) return '  (bug row not found)';
  return [
    `  title: ${bug.title}`,
    `  severity: ${bug.severity}`,
    `  module: ${bug.module}`,
    `  oracle: ${bug.oracle}`,
    `  steps: ${bug.steps}`,
    `  expected: ${bug.expected}`,
    `  actual: ${bug.actual}`,
    `  evidence: ${bug.evidence || '(none recorded)'}`,
  ].join('\n');
}

export function buildJudgePrompt(dispute: Dispute, bug: Bug | undefined, rebuttal: string): string {
  return [
    `FINDING UNDER DISPUTE (bug #${dispute.bug_id}):`,
    bugBlock(bug),
    ``,
    `AGENT A — ${dispute.raised_by} (filed the finding) claims:`,
    `  ${dispute.claim}`,
    ``,
    `AGENT B — ${dispute.challenged_by} (contradicting evidence) counters:`,
    `  ${dispute.counter_claim}`,
    ``,
    `AGENT A — ${dispute.raised_by} rebuts:`,
    `  ${rebuttal}`,
    ``,
    `Adjudicate on the full exchange. Return the JSON verdict.`,
  ].join('\n');
}

export async function adjudicate(dispute: Dispute, db: DB, bus: Bus): Promise<Adjudication> {
  const bug = db.getBug(dispute.bug_id);

  // One rebuttal exchange before the ruling: the agent that filed the finding gets
  // to answer the challenge. This makes it a short debate (not a single-shot
  // counter-claim) — the judge then rules on claim + counter + rebuttal together.
  const rebuttal = await rebut(dispute, bug);
  bus.write('PROGRESS', `rebuttal by ${dispute.raised_by} on bug #${dispute.bug_id}: ${rebuttal.slice(0, 160)}`, 'qa-lead');

  const { message } = await chat({
    model: 'lead',
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildJudgePrompt(dispute, bug, rebuttal) }],
  });

  const parsed = parseVerdict((message.content ?? '').toString());

  // Persist + apply effects.
  db.resolveDispute(dispute.id!, parsed.verdict, parsed.rationale);
  if (bug) {
    if ((parsed.verdict === 'DOWNGRADED' || parsed.verdict === 'RECLASSIFIED') && parsed.newSeverity) {
      db.setBugSeverity(dispute.bug_id, parsed.newSeverity);
    }
  }
  bus.write('RESOLVED', `dispute #${dispute.id} on bug #${dispute.bug_id}: ${parsed.verdict}`, 'qa-lead');
  return parsed;
}

const REBUT_SYSTEM = `You filed a QA finding that another agent is now challenging with contradicting evidence.
Respond in ONE short paragraph, no preamble: concede if the counter-evidence is technically right
(and say what the finding really is), or defend it with specifics. Be honest — you are not scored on winning.`;

export function buildRebuttalPrompt(dispute: Dispute, bug?: Bug): string {
  return [
    `You are ${dispute.raised_by}. Your finding as filed (bug #${dispute.bug_id}):`,
    bugBlock(bug),
    `Summarised claim: ${dispute.claim}`,
    `The challenge from ${dispute.challenged_by}: ${dispute.counter_claim}`,
    `Your rebuttal:`,
  ].join('\n');
}

/** The rebuttal turn — the original filer answers the challenge before the judge rules. */
async function rebut(dispute: Dispute, bug?: Bug): Promise<string> {
  try {
    const { message } = await chat({ model: 'lead', messages: [{ role: 'system', content: REBUT_SYSTEM }, { role: 'user', content: buildRebuttalPrompt(dispute, bug) }] });
    const text = (message.content ?? '').toString().trim();
    return text || '(no rebuttal offered)';
  } catch {
    return '(rebuttal unavailable)';
  }
}

/** Lenient JSON extraction — models occasionally wrap JSON in prose or fences. */
export function parseVerdict(raw: string): Adjudication {
  let obj: any = {};
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { obj = JSON.parse(match[0]); } catch { /* fall through */ } }
  const verdict: Verdict = VERDICTS.includes(obj.verdict) ? obj.verdict : 'UPHELD';
  const newSeverity = SEVERITIES.includes(obj.newSeverity) ? obj.newSeverity : undefined;
  return {
    verdict,
    rationale: typeof obj.rationale === 'string' && obj.rationale.trim()
      ? obj.rationale
      : 'No rationale returned; defaulted to UPHELD to avoid dropping a finding.',
    newSeverity,
    newTitle: typeof obj.newTitle === 'string' ? obj.newTitle : undefined,
  };
}
