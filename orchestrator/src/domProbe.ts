import { chromium } from 'playwright';

/**
 * Deterministic DOM probe (orchestrator-side, NOT a model tool). The script-writer
 * running on qwen-plus hallucinates selectors — it invents labels/ids/testids that
 * do not exist even after running its own probe, because the probe output gets
 * compacted out of its context. So we probe the real DOM here, in plain code, and
 * inject the ground-truth element inventory into the script-writer's TASK message
 * (which agentLoop never compacts). The model can then only ground selectors in
 * what actually exists.
 */

/** Visit each route with a headless browser and return a compact real-element inventory. */
export async function probeRoutes(siteUrl: string, routes: string[]): Promise<string> {
  const base = siteUrl.replace(/\/$/, '');
  const browser = await chromium.launch({ headless: true });
  const blocks: string[] = [];
  try {
    for (const route of routes) {
      const page = await browser.newPage();
      try {
        const resp = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 15000 });
        if (resp && resp.status() >= 400) { await page.close(); continue; } // skip 404/500
        // NOTE: no nested named helper functions inside evaluate() — tsx/esbuild wraps them
        // with a __name() call that is undefined in the browser context ("__name is not
        // defined"). Keep the trim logic inline.
        const els = await page.evaluate(() => {
          const sel = 'button,input,select,textarea,a[href],[role],[data-testid],h1,h2,h3,label';
          return Array.from(document.querySelectorAll(sel)).map((e) => {
            const el = e as HTMLElement;
            const id = el.getAttribute('id') || undefined;
            let label: string | undefined;
            if (id) {
              const l = document.querySelector(`label[for="${id}"]`);
              if (l) label = (l.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
            }
            const tag = el.tagName;
            const isText = ['BUTTON', 'A', 'H1', 'H2', 'H3', 'LABEL'].indexOf(tag) >= 0;
            return {
              tag,
              type: el.getAttribute('type') || undefined,
              id,
              name: el.getAttribute('name') || undefined,
              role: el.getAttribute('role') || undefined,
              testid: el.getAttribute('data-testid') || undefined,
              label,
              placeholder: (el as HTMLInputElement).placeholder || undefined,
              text: isText ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : undefined,
            };
          }).filter((e) => e.id || e.name || e.testid || e.text || e.placeholder || e.role);
        });
        if (!els.length) { await page.close(); continue; }
        const lines = els.map((e) => {
          const parts = [e.tag.toLowerCase()];
          if (e.type) parts.push(`type=${e.type}`);
          if (e.id) parts.push(`id="${e.id}"`);
          if (e.name) parts.push(`name="${e.name}"`);
          if (e.testid) parts.push(`data-testid="${e.testid}"`);
          if (e.role) parts.push(`role=${e.role}`);
          if (e.label) parts.push(`label="${e.label}"`);
          if (e.placeholder) parts.push(`placeholder="${e.placeholder}"`);
          if (e.text) parts.push(`text="${e.text}"`);
          return `    ${parts.join(' ')}`;
        });
        blocks.push(`  ROUTE ${route}\n${lines.join('\n')}`);
      } catch {
        await page.close().catch(() => {});
        continue; // route unreachable — skip, never fabricate
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return blocks.join('\n\n');
}

/** Routes worth probing: the root plus any UI path named in the site map (never /api*). */
export function routesToProbe(siteMap: string | undefined): string[] {
  const routes = new Set<string>(['/']);
  for (const m of (siteMap ?? '').matchAll(/\/[a-zA-Z][\w/-]*/g)) {
    if (!m[0].startsWith('/api')) routes.add(m[0]);
  }
  return [...routes].slice(0, 6);
}
