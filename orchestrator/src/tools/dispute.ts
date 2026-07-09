import type { ToolDef } from '../agentLoop.js';
import type { DB } from '../db.js';
import type { Bus } from '../bus.js';

/**
 * raise_dispute — any worker calls this when its own evidence contradicts a bug
 * another agent already filed. It records an OPEN dispute and emits a DISPUTE
 * signal; the QA Lead adjudicates it in the consolidation phase (see adjudicate.ts).
 * This is the agent-facing half of the Track-3 conflict-resolution mechanism.
 */
export function raiseDisputeTool(db: DB, bus: Bus, selfName: string): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'raise_dispute',
        description:
          'Flag that your evidence contradicts a bug another agent filed. Use only when you have concrete, contradicting evidence about the SAME behaviour (e.g. the API returns the correct status for a finding filed from the UI). The QA Lead will adjudicate.',
        parameters: {
          type: 'object',
          properties: {
            bugId: { type: 'integer', description: 'id of the filed bug you are challenging' },
            raisedBy: { type: 'string', description: 'the agent that filed the bug (e.g. qa-hawk)' },
            claim: { type: 'string', description: 'the finding as it was filed, in one sentence' },
            counterClaim: { type: 'string', description: 'your contradicting evidence, concrete and specific' },
          },
          required: ['bugId', 'claim', 'counterClaim'],
        },
      },
    },
    run: (args: { bugId: number; raisedBy?: string; claim: string; counterClaim: string }) => {
      const bug = db.getBug(args.bugId);
      if (!bug) return `ERROR: no bug #${args.bugId} to dispute.`;
      const id = db.raiseDispute({
        bug_id: args.bugId,
        raised_by: args.raisedBy || bug.found_by,
        challenged_by: selfName,
        claim: args.claim,
        counter_claim: args.counterClaim,
      });
      bus.write('DISPUTE', `${id}`, selfName);
      return `Dispute #${id} raised against bug #${args.bugId}; the QA Lead will adjudicate. Continue with your other work.`;
    },
  };
}
