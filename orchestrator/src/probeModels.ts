import 'dotenv/config';
import OpenAI from 'openai';

/** One tiny call per candidate model — maps which buckets this key can actually use. */
const candidates = [
  'qwen-max',
  'qwen3-max-2025-09-23',
  'qwen-plus-2025-07-28',
  'qwen-plus-latest',
  'qwen-flash-2025-07-28',
  'qwen-turbo-latest',
  'qwen3-30b-a3b-instruct-2507',
  'qwen-vl-max',
  'qwen-vl-max-2025-08-13',
  'qwen3-vl-plus',
];

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

for (const model of candidates) {
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    });
    console.log(`OK      ${model}`);
  } catch (e: any) {
    console.log(`${String(e.status ?? 'ERR').padEnd(7)} ${model} — ${String(e.message).slice(0, 80)}`);
  }
}
