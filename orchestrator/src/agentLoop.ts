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

    for (let iter = 1; iter <= maxIterations; iter++) {
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
          if (!tool) {
            result = `ERROR: unknown tool ${call.function.name}`;
          } else {
            try {
              const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              result = await tool.run(args);
            } catch (err: any) {
              result = `ERROR executing ${call.function.name}: ${err.message}`;
            }
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
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
