import type { ToolDef } from '../agentLoop.js';

const MAX_BODY_CHARS = 4000;
const TIMEOUT_MS = 15_000;

/**
 * http_request — qa-api-tester's probe. Plain fetch with a timeout; returns
 * status + headers + (truncated) body so the model can judge the response
 * against the OpenAPI spec. Never throws — errors come back as text so the
 * agent can file a bug about them instead of crashing.
 */
export function httpRequestTool(): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'http_request',
        description:
          'Send one HTTP request to the app under test and get status, headers and body back. Use it to exercise every endpoint in the OpenAPI spec: happy path, missing/invalid fields, wrong auth, boundary values.',
        parameters: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            url: { type: 'string', description: 'full URL including host, e.g. http://localhost:3000/api/tasks' },
            headers: {
              type: 'object',
              description: 'request headers, e.g. {"Authorization": "Bearer ...", "Content-Type": "application/json"}',
              additionalProperties: { type: 'string' },
            },
            body: { type: 'string', description: 'raw request body, usually a JSON string (optional)' },
          },
          required: ['method', 'url'],
        },
      },
    },
    run: async (args: { method: string; url: string; headers?: Record<string, string>; body?: string }) => {
      const headers: Record<string, string> = { ...(args.headers ?? {}) };
      if (args.body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
      try {
        const res = await fetch(args.url, {
          method: args.method,
          headers,
          body: args.body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'manual',
        });
        let body = await res.text();
        if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS) + `\n…(truncated, ${body.length} chars total)`;
        const headerLines = ['content-type', 'location', 'set-cookie', 'www-authenticate']
          .map((h) => (res.headers.get(h) ? `${h}: ${res.headers.get(h)}` : null))
          .filter(Boolean)
          .join('\n');
        return `HTTP ${res.status} ${res.statusText}\n${headerLines}\n\n${body || '(empty body)'}`;
      } catch (err: any) {
        const reason = err?.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS}ms` : err.message;
        return `ERROR: request failed — ${reason}. If the app is unreachable after retries, write BLOCKED to the bus.`;
      }
    },
  };
}
