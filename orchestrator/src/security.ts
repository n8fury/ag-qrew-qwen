import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import type { RunContext } from './agents/worker.js';
import { parseSpecPaths } from './tools/store.js';

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

/**
 * Returns an error message if `val` is not an http(s) URL whose host passes the
 * deny-list, else null. Shared by the RunContext schema and the /api/preview
 * endpoint (Phase C) so the site policy lives in exactly one place.
 */
export function siteUrlError(val: string): string | null {
  let url: URL;
  try {
    url = new URL(val);
  } catch {
    return `site must be a valid URL, got "${val}"`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `site must be http(s), got ${url.protocol}//`;
  }
  const denied = deniedHost(url.hostname);
  if (denied) return `site host ${url.hostname} is not allowed: ${denied}`;
  return null;
}

/** http(s) URL whose host passes the deny-list. */
const siteUrl = z.string().superRefine((val, ctx2) => {
  const err = siteUrlError(val);
  if (err) ctx2.addIssue({ code: z.ZodIssueCode.custom, message: err });
});

export const RunContextSchema = z.object({
  project: z.string().min(1).max(200),
  sprint: z.number().int().positive(),
  // site and docText are OPTIONAL since general-input runs: any subset of
  // (site, docText, spec) ≥ 1 describes a run — see validateRunContext.
  site: siteUrl.optional(),
  apiSpecPath: z.string().max(500).optional(),
  modules: z.array(z.string().min(1).max(100)).min(1).max(20),
  creds: z.object({
    adminEmail: z.string().max(200).optional(),
    adminPassword: z.string().max(200).optional(),
    userEmail: z.string().max(200).optional(),
    userPassword: z.string().max(200).optional(),
  }).optional(),
  docText: z.string().min(1).max(50_000).optional(),
  siteMap: z.string().max(5_000).optional(),
  appNotes: z.string().max(10_000).optional(),
  priorityOracles: z.object({
    api: z.string().max(5_000).optional(),
    explore: z.string().max(5_000).optional(),
  }).optional(),
});

export type ValidatedCtx =
  | { ok: true; ctx: RunContext }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

/**
 * Validate a client-supplied RunContext (unknown keys are stripped by zod).
 * `specProvided` counts as the third possible input: a ctx with neither site
 * nor docText is only runnable when an OpenAPI spec is present. The error case
 * carries both a flat `error` string (logs) and a `fieldErrors` map (so the
 * dashboard can show each problem against its field).
 */
export function validateRunContext(input: unknown, specProvided = false): ValidatedCtx {
  const res = RunContextSchema.safeParse(input);
  if (!res.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of res.error.issues) {
      const key = i.path.join('.') || 'ctx';
      if (!fieldErrors[key]) fieldErrors[key] = i.message; // first issue per field
    }
    const error = Object.entries(fieldErrors).map(([k, m]) => `${k}: ${m}`).join('; ');
    return { ok: false, error, fieldErrors };
  }
  if (!res.data.site && !res.data.docText && !specProvided) {
    const msg = 'at least one input is required — a target URL (site), a requirements document (docText), or an OpenAPI spec';
    return { ok: false, error: `ctx: ${msg}`, fieldErrors: { ctx: msg } };
  }
  return { ok: true, ctx: res.data };
}

// ── uploaded OpenAPI spec acceptance (Phase C.2) ──────────────────────────────
const MAX_SPEC_BYTES = 1_000_000; // 1 MB

export type SpecAcceptance = { ok: true; text: string } | { ok: false; error: string };

/**
 * Gate a client-uploaded OpenAPI spec before it is written to qa/openapi.yaml:
 * a non-empty string, ≤1 MB, that yields ≥1 documented path via `parseSpecPaths`
 * (the same block-YAML parser the api-tester's fabricated-endpoint guard uses —
 * so anything accepted here is actually usable downstream).
 */
export function acceptSpecYaml(specYaml: unknown): SpecAcceptance {
  if (typeof specYaml !== 'string' || specYaml.trim() === '') {
    return { ok: false, error: 'specYaml must be a non-empty string' };
  }
  if (Buffer.byteLength(specYaml, 'utf8') > MAX_SPEC_BYTES) {
    return { ok: false, error: 'specYaml exceeds the 1 MB limit' };
  }
  if (parseSpecPaths(specYaml).size === 0) {
    return {
      ok: false,
      error: 'specYaml documents no paths — expected an OpenAPI block-style "paths:" section with ≥1 path',
    };
  }
  return { ok: true, text: specYaml };
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
