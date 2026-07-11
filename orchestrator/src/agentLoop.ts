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
const MAX_TOOL_RESULT_CHARS = 4000;
const KEEP_LAST_RESULTS_VERBATIM = 1;  // keep only the very last result verbatim
const COMPACT_AFTER_ITERATIONS = 1;    // compact aggressively: after just 1 iteration

interface ToolResultRef {
  msgIndex: number;      // position of the tool message in `messages`
  insertedIter: number;  // iteration whose tool_calls produced it
  summary: string;       // precomputed 1–2 line replacement
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
  return `[tool result truncated: ${hint} → ${gist}${size} — re-run the tool if you need the full output]`;
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

      let res;
      try {
        res = await chat({ model, messages, tools: toolSchemas });
      } catch (err: any) {
        bus.write('BLOCKED', `${name} API error: ${err.message}`, name);
        return { name, status: 'error', iterations: iter, tokens, finalText: err.message };
      }
      tokens += res.usageTokens;
      const msg = res.message;
      messages.push(msg as ChatCompletionMessageParam);

      if (msg.tool_calls && msg.tool_calls.length) {
        for (const call of msg.tool_calls) {
          const tool = tools[call.function.name];
          let result: string;
          let args: any = {};
          if (!tool) {
            result = `ERROR: unknown tool ${call.function.name}`;
          } else {
            try {
              args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              result = await tool.run(args);
            } catch (err: any) {
              result = `ERROR executing ${call.function.name}: ${err.message}`;
            }
          }
          if (result.length > MAX_TOOL_RESULT_CHARS) {
            result = result.slice(0, MAX_TOOL_RESULT_CHARS) +
              `\n…[truncated at ${MAX_TOOL_RESULT_CHARS} of ${result.length} chars — re-run the tool with a narrower request if you need the rest]`;
          }
          const hint = callHint(call.function.name, args);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          toolResults.push({
            msgIndex: messages.length - 1,
            insertedIter: iter,
            summary: summarizeToolResult(hint, result),
            compacted: false,
          });
        }
        if (tokens > maxTokens) {
          bus.write('BLOCKED', `${name} exceeded token budget (${tokens})`, name);
          return { name, status: 'exhausted', iterations: iter, tokens, finalText: '' };
        }
        continue; // feed tool results back to the model
      }

      // Plain text turn — treat as completion.
      const text = (msg.content ?? '').toString();
      bus.write('DONE', name, name);
      return { name, status: 'done', iterations: iter, tokens, finalText: text };
    }

    bus.write('BLOCKED', `${name} hit iteration cap`, name);
    return { name, status: 'exhausted', iterations: maxIterations, tokens, finalText: '' };
  }
}
