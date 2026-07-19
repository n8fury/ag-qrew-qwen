import 'dotenv/config';

/** Typed, validated runtime config. Fail fast on a missing API key. */
function req(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith('YOUR_')) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}
function opt(name: string, fallback: string): string {
  return process.env[name] && !process.env[name]!.startsWith('YOUR_') ? process.env[name]! : fallback;
}
/** Numeric env with fail-fast validation — a NaN budget would silently disable
 *  the token/iteration guards (`tokens > NaN` is always false). */
export function optNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Env var ${name} must be a positive number, got "${raw}".`);
  }
  return n;
}

/** Offline harness mode (AGQREW_MOCK=1): stub the model so the pipeline runs with no key. */
export const MOCK = process.env.AGQREW_MOCK === '1';

export const config = {
  qwen: {
    apiKey: MOCK ? (process.env.DASHSCOPE_API_KEY ?? 'mock-key') : req('DASHSCOPE_API_KEY'),
    baseURL: opt('QWEN_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
    models: {
      lead: opt('QWEN_MODEL_LEAD', 'qwen-max'),
      worker: opt('QWEN_MODEL_WORKER', 'qwen-plus'),
      vision: opt('QWEN_MODEL_VISION', 'qwen-vl-max'),
    },
  },
  agent: {
    maxIterations: optNumber('AGENT_MAX_ITERATIONS', 25),
    maxTokens: optNumber('AGENT_MAX_TOKENS', 150_000),
  },
  server: { port: optNumber('PORT', 8787) },
  demoAppUrl: opt('DEMO_APP_URL', 'http://localhost:3000'),
  dbPath: opt('DB_PATH', './qa/agqrew.db'),
  busPath: opt('BUS_PATH', './qa/shared-task-list.txt'),
} as const;

export type QwenModel = 'lead' | 'worker' | 'vision';
