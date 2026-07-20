import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { chat } from './qwen.js';
import { config, type QwenModel } from './config.js';
import type { Bus } from './bus.js';

/**
 * The real engineering (plan §4.2): one reusable AgentLoop, instantiated five
 * times with different configs (QA Lead + 4 workers). Rebuilds Claude Code's
 * spawn/tool-call/loop on the Qwen function-calling API.
 *
 *   loop:
 *     response = qwen.chat(messages, tools)
 *     if tool_calls -> execute each -> append results -> continue
 *     if text + done -> write DONE to bus, exit
 *   guards: max iterations, max output-token budget per agent
 */
export interface ToolDef {
  schema: ChatCompletionTool;
  /** Executes the tool call; returns a string result appended back to the model. */
  run: (args: any) => Promise<string> | string;
}

export interface AgentConfig {
  name: string;                 // e.g. "qa-tc-writer" — also the bus `from` id
  model: QwenModel;             // 'lead' | 'worker' | 'vision'
  systemPrompt: string;         // ported & trimmed from the original .md
  tools: Record<string, ToolDef>;
  bus: Bus;
  /** Per-agent overrides of the global guards (plan §4.2 "per-agent budgets"). */
  maxIterations?: number;
  maxTokens?: number;
}

export interface AgentOutcome {
  name: string; status: 'done' | 'blocked' | 'exhausted' | 'error';
  iterations: number; tokens: number; finalText: string;
}

// ── Context management ────────────────────────────────────────────────────────
// Every iteration re-sends the whole conversation, so without pruning a
// 20-iteration worker burns 250–350k tokens and dies at its budget. Two guards:
//   1. cap any single tool result at insertion time (playwright/http already cap
//      their own output; this is the enforcement point for fs_read, tc_list, …)
//   2. once a tool result has been consumed for ≥3 iterations AND is not one of
//      the 3 most recent results, collapse it in place to a 1–2 line summary.
// The system prompt and the task message are never touched.
const MAX_TOOL_RESULT_CHARS = 2500;
// Keep-last 2 / compact-after 2 (NOT 1/1): the agent is usually still working
// FROM its most recent reads — compacting the test plan away one iteration
// after reading it forced qa-tc-writer into an endless re-read loop (19×
// fs_read of the same file in run #6). Keep-last was 3; trimmed to 2 as a
// safe token-reduction knob (still verbatim for ≥2 iterations via compact-after).
const KEEP_LAST_RESULTS_VERBATIM = 2;
const COMPACT_AFTER_ITERATIONS = 2;

interface ToolResultRef {
  msgIndex: number;      // position of the tool message in `messages`
  insertedIter: number;  // iteration whose tool_calls produced it
  summary: string;       // precomputed 1–2 line replacement
  compacted: boolean;
}

// Assistant tool-call ARGUMENTS need the same treatment as results: an fs_write
// or tc_store call carries the entire file/case payload in its arguments, and
// re-sending those every iteration is what pushed qa-tc-writer to ~19k tokens
// per call by iteration 12. Stale big arguments collapse to a stub (valid JSON —
// DashScope rejects history with non-JSON arguments).
const MAX_STALE_ARG_CHARS = 400;

interface AssistantCallRef {
  msgIndex: number;
  insertedIter: number;
  hints: string[];       // per tool_call, e.g. "fs_write qa/test-cases/auth-tc.txt"
  compacted: boolean;
}

/** Short human hint of what the call was, e.g. `fs_read test-plan-sprint1.txt`. */
function callHint(name: string, args: any): string {
  if (!args || typeof args !== 'object') return name;
  if (name === 'http_request') return `${name} ${args.method ?? ''} ${args.url ?? ''}`.trim();
  const key = args.path ?? args.specPath ?? args.url ?? args.module ?? args.title ?? args.type;
  return key !== undefined ? `${name} ${String(key)}` : name;
}

/** 1–2 line summary a stale tool result is replaced with (first line kept as the gist). */
function summarizeToolResult(hint: string, result: string): string {
  const lines = result.split('\n');
  const gist = (lines.find((l) => l.trim()) ?? '(empty)').trim().slice(0, 160);
  const size = lines.length > 1 ? ` …(${lines.length} lines total)` : '';
  // NEVER invite a re-run here — an earlier "re-run the tool if you need the
  // full output" wording sent qwen-plus into infinite re-read loops.
  return `[stale tool result compacted: ${hint} → ${gist}${size} — already consumed; do NOT call this tool with the same arguments again]`;
}

// ── Tool-argument parsing ─────────────────────────────────────────────────────
// qwen-plus sometimes emits function.arguments that are not valid JSON (literal
// newlines inside strings, markdown fences, trailing commas) — most often on
// large payloads like tc_store's cases array. Two consequences without repair:
//   1. JSON.parse fails locally → tool errors → the model retries → iteration churn
//   2. the malformed assistant message stays in history and DashScope 400s the
//      NEXT request ("function.arguments must be in JSON format") — a fatal,
//      non-retriable kill (this is what took out qa-api-tester).
// So: repair what we can, and ALWAYS write valid JSON back into the message.

/** Escape raw control characters that appear inside JSON string literals. */
export function escapeControlCharsInStrings(s: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === '"') { inString = false; out += c; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      // any other raw control char (\b, \f, \x00…\x1f) is equally invalid JSON
      if (c < '\x20') { out += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'); continue; }
      out += c;
    } else {
      if (c === '"') inString = true;
      out += c;
    }
  }
  return out;
}

/** Parse tool-call arguments, repairing common model mistakes. Null = unrepairable. */
export function parseToolArgs(rawIn: string | null | undefined): { args: any } | null {
  const raw = (rawIn ?? '').trim();
  if (!raw) return { args: {} };
  try { return { args: JSON.parse(raw) }; } catch { /* try repairs below */ }
  let t = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  t = escapeControlCharsInStrings(t);
  try { return { args: JSON.parse(t) }; } catch { /* one more repair */ }
  t = t.replace(/,\s*([}\]])/g, '$1'); // trailing commas
  try { return { args: JSON.parse(t) }; } catch { /* last resort: close what was left open */ }
  t = closeUnterminated(t);
  try { return { args: JSON.parse(t) }; } catch { return null; }
}

/** Close an unterminated trailing string and any unclosed braces/brackets — models
 *  cut payloads off mid-string when they run out of output budget. */
export function closeUnterminated(s: string): string {
  let inString = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') { if (stack[stack.length - 1] === c) stack.pop(); }
  }
  let out = s;
  if (inString) out += '"';
  while (stack.length) out += stack.pop();
  return out;
}

// ── Loop-guard escalation ─────────────────────────────────────────────────────
// Nudge at 3 identical (call, result) pairs; at 5, stop feeding the result back
// at all — the content itself is the bait. Bad-JSON attempts get their own
// wording (the server was never contacted, so "retry the SAME call with fixed
// JSON" is right at 3), but they too must hit the hard stop at 5: before this
// was extracted, the `!parsed` branch shadowed the withhold branch forever and
// a malformed-payload loop could burn the whole iteration budget.
export function applyLoopGuard(toolName: string, result: string, parsed: boolean, repeats: number): string {
  if (repeats >= 5) {
    const cause = parsed
      ? `with identical arguments and an identical result`
      : `with the SAME malformed (non-JSON) arguments`;
    return `[loop guard] Call #${repeats} of ${toolName} ${cause}. The result is now WITHHELD. You are stuck ` +
      `in a loop. ${parsed ? '' : 'Do NOT retry this payload — log the test as SKIPPED in your artefact. '}` +
      `Issue a DIFFERENT call that advances your task (your next deliverable per your instructions), ` +
      `or finish with a plain-text summary of what is done and what is blocked.`;
  }
  if (repeats >= 3) {
    return parsed
      ? result + `\n\n[loop guard] You have now made this EXACT call ${repeats} times and received the SAME result each time. ` +
        `Do NOT repeat it — you already have this information. Move on to your next deliverable.`
      : result + `\n\n[loop guard] This is malformed-JSON failure #${repeats} for this exact payload. The server was ` +
        `NEVER contacted — this is your argument formatting, not the target failing, so it never counts as "unreachable". ` +
        `Rewrite the arguments as ONE compact line (shorter strings, fewer headers/fields). If you cannot express this ` +
        `payload, log the test as SKIPPED in your artefact and move to your next deliverable.`;
  }
  return result;
}

export class AgentLoop {
  constructor(private cfg: AgentConfig) {}

  async run(task: string): Promise<AgentOutcome> {
    const { name, model, systemPrompt, tools, bus } = this.cfg;
    const maxIterations = this.cfg.maxIterations ?? config.agent.maxIterations;
    const maxTokens = this.cfg.maxTokens ?? config.agent.maxTokens;
    const toolSchemas = Object.values(tools).map((t) => t.schema);
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];
    let tokens = 0;
    const toolResults: ToolResultRef[] = [];
    const assistantCalls: AssistantCallRef[] = [];
    // Loop guard: count identical (tool, args) calls WITH identical results — a
    // model stuck re-issuing the same call burns the whole iteration budget
    // (qa-tc-writer: 40 iterations in ~37s on Day 1; 19× fs_read in run #6).
    // A repeated call whose result CHANGED (e.g. bus_read after new signals)
    // resets the counter — that repetition is legitimate.
    const seenCalls = new Map<string, { n: number; last: string }>();

    for (let iter = 1; iter <= maxIterations; iter++) {
      // Compact stale tool results before re-sending the conversation: anything
      // consumed for ≥COMPACT_AFTER_ITERATIONS iterations, except the newest
      // KEEP_LAST_RESULTS_VERBATIM results, shrinks to its summary line.
      for (let i = 0; i < toolResults.length - KEEP_LAST_RESULTS_VERBATIM; i++) {
        const ref = toolResults[i];
        if (!ref.compacted && iter - ref.insertedIter > COMPACT_AFTER_ITERATIONS) {
          (messages[ref.msgIndex] as { content: string }).content = ref.summary;
          ref.compacted = true;
        }
      }
      // Same for stale assistant tool-call arguments (skip the newest message).
      for (let i = 0; i < assistantCalls.length - 1; i++) {
        const ref = assistantCalls[i];
        if (ref.compacted || iter - ref.insertedIter <= COMPACT_AFTER_ITERATIONS) continue;
        const m = messages[ref.msgIndex] as { tool_calls?: { function: { arguments: string } }[] };
        m.tool_calls?.forEach((c, j) => {
          if (c.function.arguments.length > MAX_STALE_ARG_CHARS) {
            c.function.arguments = JSON.stringify({
              _compacted: `${ref.hints[j] ?? 'call'} — arguments elided (${c.function.arguments.length} chars, already executed)`,
            });
          }
        });
        ref.compacted = true;
      }

      let res;
      try {
        res = await chat({ model, messages, tools: toolSchemas });
      } catch (err: any) {
        bus.write('BLOCKED', `${name} API error: ${err.message}`, name);
        bus.activity({ agent: name, iter, maxIter: maxIterations, tokensAgent: tokens, tokensDelta: 0, calls: [], state: 'blocked' });
        return { name, status: 'error', iterations: iter, tokens, finalText: err.message };
      }
      tokens += res.usageTokens;
      const msg = res.message;
      messages.push(msg as ChatCompletionMessageParam);

      if (msg.tool_calls && msg.tool_calls.length) {
        const trace: string[] = [];
        const callRef: AssistantCallRef = {
          msgIndex: messages.length - 1, insertedIter: iter, hints: [], compacted: false,
        };
        assistantCalls.push(callRef);
        for (const call of msg.tool_calls) {
          const tool = tools[call.function.name];
          const rawArgs = call.function.arguments ?? '';
          const parsed = parseToolArgs(rawArgs);
          // Always write valid JSON back into the assistant message — DashScope
          // rejects the whole NEXT request (400, non-retriable) if history
          // contains non-JSON function.arguments.
          call.function.arguments = parsed ? JSON.stringify(parsed.args) : '{}';
          const args: any = parsed?.args ?? {};
          let result: string;
          if (!tool) {
            result = `ERROR: unknown tool ${call.function.name}`;
          } else if (!parsed) {
            result = `ERROR: the arguments of your ${call.function.name} call were not valid JSON and could not be repaired. ` +
              `Re-issue the call with STRICTLY valid JSON: escape every newline inside a string as \\n, no trailing commas, no markdown fences. ` +
              `If the payload is large, split it into smaller calls.`;
          } else {
            try {
              result = await tool.run(args);
            } catch (err: any) {
              result = `ERROR executing ${call.function.name}: ${err.message}`;
            }
          }
          if (result.length > MAX_TOOL_RESULT_CHARS) {
            result = result.slice(0, MAX_TOOL_RESULT_CHARS) +
              `\n…[truncated at ${MAX_TOOL_RESULT_CHARS} of ${result.length} chars — re-run the tool with a narrower request if you need the rest]`;
          }
          // Loop guard: nudge at 3 identical (call, result) pairs; at 5, stop
          // feeding the result back at all — the content itself is the bait.
          // Unparseable calls were rewritten to '{}' above, which would fold every
          // bad-JSON attempt of a tool into ONE signature and trip the guard with
          // "issue a DIFFERENT call" — the opposite of the right advice (retry the
          // SAME call with fixed JSON). Key those on the raw text instead, and give
          // them their own escalation.
          const sig = parsed
            ? `${call.function.name}|${call.function.arguments}`
            : `${call.function.name}|!json|${rawArgs.slice(0, 300)}`;
          const prev = seenCalls.get(sig);
          const repeats = prev && prev.last === result ? prev.n + 1 : 1;
          seenCalls.set(sig, { n: repeats, last: result });
          result = applyLoopGuard(call.function.name, result, parsed !== null, repeats);
          const hint = callHint(call.function.name, args);
          callRef.hints.push(hint);
          trace.push(`${hint}${parsed ? '' : ' [bad-json]'}${repeats >= 3 ? ` [x${repeats}]` : ''}`);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          toolResults.push({
            msgIndex: messages.length - 1,
            insertedIter: iter,
            summary: summarizeToolResult(hint, result),
            compacted: false,
          });
        }
        console.log(`  [${name}] iter ${iter}/${maxIterations} · +${res.usageTokens} tok (total ${tokens}) · ${trace.join(' ; ')}`);
        // Ephemeral telemetry (Phase F): one in-memory activity event per
        // iteration — plain hints (no loop-guard annotations), never on the file.
        const exhausted = tokens > maxTokens;
        bus.activity({
          agent: name, iter, maxIter: maxIterations, tokensAgent: tokens,
          tokensDelta: res.usageTokens, calls: callRef.hints.slice(), state: exhausted ? 'blocked' : 'working',
        });
        if (exhausted) {
          bus.write('BLOCKED', `${name} exceeded token budget (${tokens})`, name);
          return { name, status: 'exhausted', iterations: iter, tokens, finalText: '' };
        }
        continue; // feed tool results back to the model
      }

      // Plain text turn — treat as completion.
      const text = (msg.content ?? '').toString();
      console.log(`  [${name}] iter ${iter}/${maxIterations} · +${res.usageTokens} tok (total ${tokens}) · done (text turn)`);
      bus.write('DONE', name, name);
      bus.activity({ agent: name, iter, maxIter: maxIterations, tokensAgent: tokens, tokensDelta: res.usageTokens, calls: [], state: 'done' });
      return { name, status: 'done', iterations: iter, tokens, finalText: text };
    }

    bus.write('BLOCKED', `${name} hit iteration cap`, name);
    bus.activity({ agent: name, iter: maxIterations, maxIter: maxIterations, tokensAgent: tokens, tokensDelta: 0, calls: [], state: 'blocked' });
    return { name, status: 'exhausted', iterations: maxIterations, tokens, finalText: '' };
  }
}
