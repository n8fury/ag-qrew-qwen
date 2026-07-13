import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, sep, join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import type { ToolDef } from '../agentLoop.js';
import { chat } from '../qwen.js';

const execP = promisify(execFile);
// On Windows, npx is npx.cmd — spawning a .cmd without a shell throws (EINVAL/ENOENT),
// so run through the shell there. Paths under qa/ contain no spaces or shell metachars.
const IS_WIN = process.platform === 'win32';
const exec = (cmd: string, args: string[], opts: { timeout: number; maxBuffer: number }) =>
  execP(cmd, args, { ...opts, shell: IS_WIN });
const RUN_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_CHARS = 5000;

function assertInsideQa(qaRoot: string, relPath: string): string {
  const root = resolve(qaRoot);
  // accept both "qa/<path>" and "<path>" — see fs.ts resolveSandboxed
  const rel = relPath.replace(/^qa[\\/]+/i, '');
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path escapes the qa/ sandbox: ${relPath}`);
  }
  return target;
}

const INSTALL_TIMEOUT_MS = 300_000;
let chromiumInstall: Promise<void> | null = null;

/**
 * Install the Chromium browser on demand — once — so a fresh environment
 * self-heals the first time a spec or snapshot actually needs a browser. This
 * runs at the TOOL layer (never the agents, which have no shell), and the
 * promise is cached so concurrent qa-script-writer + qa-hawk calls install once.
 */
function ensureChromium(): Promise<void> {
  if (!chromiumInstall) {
    chromiumInstall = exec('npx', ['playwright', 'install', 'chromium'], {
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    })
      .then(() => undefined)
      .catch((e) => {
        chromiumInstall = null; // reset so a later call can retry the install
        throw e;
      });
  }
  return chromiumInstall;
}

/** Recognise Playwright's "browser not installed" failure across its phrasings. */
const isMissingBrowser = (msg: string): boolean =>
  /Executable doesn't exist|playwright install|just installed or updated|browserType\.launch/i.test(msg || '');

/**
 * playwright_run — executes a generated spec. Specs are written by
 * qa-script-writer as plain Playwright-as-a-library scripts (import { chromium }
 * from 'playwright'; exit code 0 = pass, non-zero = fail) and run via tsx, so we
 * don't need the @playwright/test runner. Sandboxed to qa/.
 */
export function playwrightRunTool(qaRoot: string): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'playwright_run',
        description:
          'Execute one generated Playwright spec (a standalone script under qa/, e.g. "specs/login.spec.ts") and return PASS/FAIL with its output. The script must exit 0 on pass and non-zero (or throw) on fail.',
        parameters: {
          type: 'object',
          properties: {
            specPath: { type: 'string', description: 'spec path relative to qa/, e.g. "specs/login.spec.ts"' },
          },
          required: ['specPath'],
        },
      },
    },
    run: async (args: { specPath: string }) => {
      const target = assertInsideQa(qaRoot, args.specPath);
      // A missing spec must say so plainly — in run #7 the raw tsx path error
      // was misread by the agent as "chromium not installed".
      if (!existsSync(target)) {
        return `ERROR: spec file qa/${args.specPath} does not exist — fs_write it first (check the exact path; nothing was executed).`;
      }
      const runSpec = () => exec('npx', ['tsx', target], { timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
      const pass = (stdout: string, stderr: string, note = '') =>
        `PASS (exit 0${note})\n${(stdout + (stderr ? `\n${stderr}` : '')).slice(0, MAX_OUTPUT_CHARS) || '(no output)'}`;
      const fail = (err: any) => {
        if (err.killed) return `FAIL: spec timed out after ${RUN_TIMEOUT_MS / 1000}s.`;
        const out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim().slice(0, MAX_OUTPUT_CHARS);
        return `FAIL (exit ${err.code ?? '?'})\n${out || err.message}`;
      };
      try {
        const { stdout, stderr } = await runSpec();
        return pass(stdout, stderr);
      } catch (err: any) {
        const blob = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`;
        if (!isMissingBrowser(blob)) return fail(err);
        // Browser missing → install Chromium once, then re-run the spec.
        try {
          await ensureChromium();
        } catch (e: any) {
          return `FAIL: Chromium is not installed and auto-install failed — ${e.message}. Run "npx playwright install chromium".`;
        }
        try {
          const { stdout, stderr } = await runSpec();
          return pass(stdout, stderr, ', after auto-installing Chromium');
        } catch (err2: any) {
          return fail(err2);
        }
      }
    },
  };
}

/**
 * browser_snapshot — qa-hawk's eyes. Screenshots a URL with headless Chromium,
 * saves the PNG under qa/screenshots/ as evidence, then sends it to qwen-vl
 * with the caller's question and returns the vision model's analysis.
 */
export function browserSnapshotTool(qaRoot: string): ToolDef {
  let counter = 0;
  return {
    schema: {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description:
          'Open a URL in a headless browser, screenshot it, and have the vision model answer your question about what the page shows. Use it to inspect UI state: layout defects, error messages, missing/stale data, broken flows. The screenshot is saved under qa/screenshots/ — cite its path as bug evidence.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'page to inspect, e.g. http://localhost:3000/login' },
            question: {
              type: 'string',
              description: 'what to analyse, e.g. "List every visible defect: misaligned elements, overlapping text, wrong labels, empty states."',
            },
          },
          required: ['url', 'question'],
        },
      },
    },
    run: async (args: { url: string; question: string }) => {
      const attempt = async (): Promise<string> => {
        let browser;
        try {
          browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADED !== '1' });
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await page.goto(args.url, { waitUntil: 'networkidle', timeout: 30_000 });
          const n = String(++counter).padStart(3, '0');
          const shotPath = join(resolve(qaRoot), 'screenshots', `snap-${n}.png`);
          mkdirSync(dirname(shotPath), { recursive: true });
          const png = await page.screenshot({ path: shotPath, fullPage: true });
          const b64 = Buffer.from(png).toString('base64');
          const res = await chat({
            model: 'vision',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: `You are a meticulous QA analyst inspecting a screenshot of ${args.url}. ` +
                    `FIRST, transcribe verbatim every visible heading and any counter/count text exactly as rendered ` +
                    `(e.g. "Tasks (3)" — if a heading literally shows a non-value like "undefined" or "NaN", quote it exactly). ` +
                    `THEN answer: ${args.question}` },
                  { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
                ],
              },
            ],
          });
          const analysis = (res.message.content ?? '(vision model returned no text)').toString();
          return `Screenshot saved: qa/screenshots/snap-${n}.png\n\nVision analysis:\n${analysis}`;
        } finally {
          await browser?.close().catch(() => {});
        }
      };
      try {
        return await attempt();
      } catch (err: any) {
        if (!isMissingBrowser(err.message)) {
          return `ERROR: browser_snapshot failed — ${err.message}. Retry up to 3 times, then write BLOCKED to the bus.`;
        }
        // Browser missing → install Chromium once, then re-take the snapshot.
        try {
          await ensureChromium();
        } catch (e: any) {
          return `ERROR: Chromium is not installed and auto-install failed — ${e.message}. Run "npx playwright install chromium", then retry.`;
        }
        try {
          return await attempt();
        } catch (e2: any) {
          return `ERROR: browser_snapshot failed after auto-installing Chromium — ${e2.message}.`;
        }
      }
    },
  };
}
