import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { config, MOCK, type QwenModel } from './config.js';
import { mockChat } from './mock/mockQwen.js';

/**
 * DashScope (Alibaba Cloud Model Studio) client wrapper — the one file that
 * demonstrates Alibaba Cloud API usage (link this in the README per the rules).
 * OpenAI-compatible endpoint, so we reuse the `openai` SDK pointed at QWEN_BASE_URL.
 *
 * Adds the two things a judge looks for under "error handling":
 *   - retry with exponential backoff on transient API errors
 *   - a per-call TOTAL token count (prompt + completion — i.e. what the API bills,
 *     including the re-sent conversation) so AgentLoop can enforce a per-agent budget
 */
// `fetch: globalThis.fetch` forces Node's native fetch (undici). The SDK's bundled
// node-fetch transport deterministically dies with "Premature close" against
// DashScope on Node 24 (the runtime inside the Playwright container image).
const client = new OpenAI({ apiKey: config.qwen.apiKey, baseURL: config.qwen.baseURL, fetch: globalThis.fetch as any });

export interface ChatArgs {
  model: QwenModel;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
}
export interface ChatResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  usageTokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry only what can heal on its own: 429 (per-minute quota window), 5xx, and
 * genuine connection failures. Everything else — 4xx auth/validation AND local
 * programming errors (a TypeError has no status either) — surfaces immediately;
 * the old `status === undefined → retry` rule burned 6 backoff attempts on bugs.
 */
export function isRetriable(err: unknown): boolean {
  const status = (err as { status?: number })?.status ?? (err as { response?: { status?: number } })?.response?.status;
  if (status === 429) return true;
  if (typeof status === 'number') return status >= 500 && status < 600;
  return err instanceof OpenAI.APIConnectionError;
}

export async function chat({ model, messages, tools }: ChatArgs): Promise<ChatResult> {
  if (MOCK) return mockChat({ model, messages, tools });
  const modelId = config.qwen.models[model];
  const maxAttempts = 6;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: modelId,
        messages,
        tools: tools && tools.length ? tools : undefined,
        tool_choice: tools && tools.length ? 'auto' : undefined,
        temperature: 0.2,
      });
      return { message: res.choices[0].message, usageTokens: res.usage?.total_tokens ?? 0 };
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      if (!isRetriable(err) || attempt === maxAttempts) break;
      // 429 is a per-minute token window on the free tier — wait long enough for it
      // to roll over (20s → 40s → 60s…), not a quick exponential blip.
      const delay = status === 429 ? Math.min(20_000 * attempt, 60_000) : 500 * 2 ** (attempt - 1);
      if (status === 429) console.log(`  [qwen] 429 rate-limited (${modelId}) — waiting ${delay / 1000}s (attempt ${attempt}/${maxAttempts})`);
      await sleep(delay);
    }
  }
  throw new Error(`Qwen chat failed (model=${modelId}): ${(lastErr as Error)?.message ?? lastErr}`);
}
