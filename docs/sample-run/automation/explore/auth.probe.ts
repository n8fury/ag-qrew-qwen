import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto(process.env.SITE_URL! + '/', { waitUntil: 'networkidle' });
  const els = await p.evaluate(() =>
    [...document.querySelectorAll('button,input,a,select,textarea,[role],[data-testid]')]
      .map((e) => ({ tag: e.tagName, role: e.getAttribute('role'), name: (e.textContent || '').trim().slice(0, 40),
        label: e.getAttribute('aria-label') || (e as HTMLInputElement).placeholder || null,
        testid: e.getAttribute('data-testid') })));
  console.log(JSON.stringify(els, null, 2));
  await b.close();
})();