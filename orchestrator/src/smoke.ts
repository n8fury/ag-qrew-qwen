import { chat } from './qwen.js';

/**
 * Task-0 smoke test (plan §8 — "de-risks the whole runtime").
 * Verifies the two things everything else depends on:
 *   1. a plain chat completion round-trip against DashScope
 *   2. a tool call: Qwen emits tool_calls with parseable JSON arguments
 *
 * Run: cd orchestrator && npx tsx src/smoke.ts
 */
async function main() {
  console.log('— smoke 1/2: plain chat (model: worker) —');
  const hello = await chat({
    model: 'worker',
    messages: [{ role: 'user', content: 'Reply with exactly one short sentence confirming you are Qwen.' }],
  });
  console.log(`reply: ${hello.message.content}`);
  console.log(`tokens: ${hello.usageTokens}\n`);

  console.log('— smoke 2/2: tool-call round-trip (model: worker) —');
  const toolRes = await chat({
    model: 'worker',
    messages: [
      {
        role: 'user',
        content: 'Call the echo tool with message="qwen-tools-ok". Do not answer in plain text.',
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'echo',
          description: 'Echo a message back. Used to verify function calling works.',
          parameters: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
      },
    ],
  });

  const call = toolRes.message.tool_calls?.[0];
  if (!call) {
    console.error('FAIL: model returned no tool_calls. Function calling is broken — check model name/region.');
    console.error(`model said instead: ${toolRes.message.content}`);
    process.exit(1);
  }
  const args = JSON.parse(call.function.arguments);
  console.log(`tool called: ${call.function.name}(${JSON.stringify(args)})`);
  if (call.function.name !== 'echo' || args.message !== 'qwen-tools-ok') {
    console.error('FAIL: tool call did not match the forced instruction.');
    process.exit(1);
  }

  console.log('\nSMOKE PASS — chat + function calling both work. The runtime is de-risked.');
}

main().catch((err) => {
  console.error(`SMOKE FAIL: ${err.message}`);
  console.error('Check DASHSCOPE_API_KEY, QWEN_BASE_URL (intl vs Singapore region) and model names in .env.');
  process.exit(1);
});
