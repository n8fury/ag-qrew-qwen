import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import type { RunContext } from './agents/worker.js';

/**
 * Server-side input validation + optional auth for the control API.
 *
 * /api/run used to accept an arbitrary `ctx` — combined with a publicly bound
 * port that made the server an SSRF proxy (point `site` at a cloud metadata
 * endpoint and the agents fetch it for you). Two layers close that:
 *   - RunContextSchema: shape validation + an http(s)-only, no-metadata site URL
 *   - tokenGuard: optional shared-secret on every mutating route (AGQREW_TOKEN)
 */

// ── site-URL policy ───────────────────────────────────────────────────────────
// Deny link-local/metadata targets outright — nothing legitimate about pointing
// the QA society at an IMDS endpoint. (The per-request policy for the agents'
// http_request tool builds on this in tools/http.ts.)
export function deniedHost(hostname: string): string | null {
  const h = hostname.toLowerCase();
  if (h === 'metadata.google.internal' || h === 'metadata.goog') return 'cloud metadata hostname';
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return 'link-local / cloud metadata address (169.254.0.0/16)';
  if (h === '0.0.0.0' || h === '[::]') return 'wildcard address';
  return null;
}

/** http(s) URL whose host passes the deny-list. */
const siteUrl = z.string().superRefine((val, ctx2) => {
  let url: URL;
  try {
    url = new URL(val);
  } catch {
    ctx2.addIssue({ code: z.ZodIssueCode.custom, message: `site must be a valid URL, got "${val}"` });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    ctx2.addIssue({ code: z.ZodIssueCode.custom, message: `site must be http(s), got ${url.protocol}//` });
    return;
  }
  const denied = deniedHost(url.hostname);
  if (denied) {
    ctx2.addIssue({ code: z.ZodIssueCode.custom, message: `site host ${url.hostname} is not allowed: ${denied}` });
  }
});

export const RunContextSchema = z.object({
  project: z.string().min(1).max(200),
  sprint: z.number().int().positive(),
  site: siteUrl,
  apiSpecPath: z.string().max(500).optional(),
  modules: z.array(z.string().min(1).max(100)).min(1).max(20),
  creds: z.object({
    adminEmail: z.string().max(200).optional(),
    adminPassword: z.string().max(200).optional(),
    userEmail: z.string().max(200).optional(),
    userPassword: z.string().max(200).optional(),
  }).optional(),
  docText: z.string().min(1).max(50_000),
  siteMap: z.string().max(5_000).optional(),
});

export type ValidatedCtx = { ok: true; ctx: RunContext } | { ok: false; error: string };

/** Validate a client-supplied RunContext (unknown keys are stripped by zod). */
export function validateRunContext(input: unknown): ValidatedCtx {
  const res = RunContextSchema.safeParse(input);
  if (!res.success) {
    const error = res.error.issues.map((i) => `${i.path.join('.') || 'ctx'}: ${i.message}`).join('; ');
    return { ok: false, error };
  }
  return { ok: true, ctx: res.data };
}

// ── optional shared-secret auth ───────────────────────────────────────────────
/**
 * Express middleware for mutating routes. No-op unless AGQREW_TOKEN is set
 * (local/judge runs stay friction-free); when set, requires the token via
 * `Authorization: Bearer <token>` or `X-AGQREW-TOKEN`. Read from env per
 * request so tests (and container restarts) can flip it without re-import.
 */
export function tokenGuard(req: Request, res: Response, next: NextFunction): void {
  const required = process.env.AGQREW_TOKEN;
  if (!required) { next(); return; }
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const supplied = bearer || String(req.headers['x-agqrew-token'] ?? '');
  if (supplied === required) { next(); return; }
  res.status(401).json({ ok: false, error: 'missing or invalid token (AGQREW_TOKEN is set on this server)' });
}
