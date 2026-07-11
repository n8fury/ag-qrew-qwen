// qa/automation/runner.ts — the harness every spec shares. Control flow lives here.
import { chromium, Browser, Page } from 'playwright';

export interface Case { tc: string; run: (page: Page) => Promise<void>; }
export interface Outcome { tc: string; status: 'PASS' | 'FAIL'; note?: string; }

export async function runCases(url: string, cases: Case[]): Promise<void> {
  const headed = process.env.PLAYWRIGHT_HEADED === '1';        // set for a local demo; leave off in Docker/CI
  const browser: Browser = await chromium.launch({ headless: !headed, slowMo: headed ? 300 : 0 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const results: Outcome[] = [];
  for (const c of cases) {                                  // the ONLY loop — harness-owned
    try { await c.run(page); results.push({ tc: c.tc, status: 'PASS' }); }
    catch (e) { results.push({ tc: c.tc, status: 'FAIL', note: String((e as Error).message).slice(0, 300) }); }
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));            // playwright_run returns this stdout
  if (results.some((r) => r.status === 'FAIL')) process.exit(1);
}