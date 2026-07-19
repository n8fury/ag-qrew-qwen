import type { ToolDef } from '../agentLoop.js';
import { config } from '../config.js';
import { deniedHost } from '../security.js';

const MAX_BODY_CHARS = 4000;
const TIMEOUT_MS = 15_000;

/**
 * URL policy: the agents only ever have business with the app under test.
 * Allowed hosts = the run's SITE_URL + the configured DEMO_APP_URL + any extra
 * hosts in HTTP_ALLOW_HOSTS (comma-separated escape hatch for real targets
 * behind redirects/CDNs). Link-local/metadata hosts are always denied — even if
 * allowlisted. Returns a policy-explaining error string, or null when allowed.
 */
export function checkUrlPolicy(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return `ERROR: "${rawUrl}" is not a valid absolute URL — include the scheme and host, e.g. ${config.demoAppUrl}/api/tasks.`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `ERROR: only http(s) URLs are allowed, got ${url.protocol}//`;
  }
  const denied = deniedHost(url.hostname);
  if (denied) return `ERROR: request blocked by policy — ${url.hostname} is a ${denied}. Test the app under test, not the platform.`;
  const allowed = new Set<string>();
  for (const candidate of [process.env.SITE_URL, config.demoAppUrl, ...(process.env.HTTP_ALLOW_HOSTS ?? '').split(',')]) {
    const c = (candidate ?? '').trim();
    if (!c) continue;
    try { allowed.add(new URL(c.includes('://') ? c : `http://${c}`).hostname.toLowerCase()); } catch { /* skip malformed */ }
  }
  // Loopback aliases are the same target — agents write 127.0.0.1 where the
  // task says localhost; don't false-block a legitimate probe over that.
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (loopback.some((h) => allowed.has(h))) loopback.forEach((h) => allowed.add(h));
  if (!allowed.has(url.hostname.toLowerCase())) {
    return `ERROR: request blocked by policy — host "${url.hostname}" is not the app under test ` +
      `(allowed: ${[...allowed].join(', ') || '(none configured)'}). Stay on the target site's URLs.`;
  }
  return null;
}

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
      const policyError = checkUrlPolicy(args.url);
      if (policyError) return policyError;
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
