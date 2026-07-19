// Loaded by vitest before every test file (see vitest.config.ts): force mock
// mode so importing config.ts never requires a real DASHSCOPE_API_KEY and no
// test can accidentally call the live DashScope endpoint.
process.env.AGQREW_MOCK = '1';
