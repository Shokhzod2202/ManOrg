// Browser checks against a running web app (pnpm dev) with demo data (node scripts/demo-data.mjs).
// Uses the preinstalled Playwright; screenshots go to SHOTS_DIR (default: the temp folder).
const { chromium } = require('playwright');
const { signIn } = require('./sign-in.cjs');
const OUT = process.env.SHOTS_DIR ?? require('node:os').tmpdir();
const W0 = process.env.WEB_URL;
const W = W0 ?? 'http://localhost:3000';
const roles = {
  admin: [
    'admin@sunrise.test',
    [
      '/app',
      '/app/orders',
      '/app/deliveries',
      '/app/shifts',
      '/app/hours',
      '/app/output',
      '/app/tasks',
      '/app/products',
      '/app/ingredients',
      '/app/people',
      '/app/settings',
      '/app/notifications',
      '/app/more',
      '/app/finance',
      '/app/bot',
      '/wall',
    ],
  ],
  mina: [
    'mina@sunrise.test',
    [
      '/app',
      '/app/orders',
      '/app/output',
      '/app/shifts',
      '/app/hours',
      '/app/tasks',
      '/app/ingredients',
    ],
  ],
  cafe: [
    'admin@citycafe.test',
    ['/app', '/app/orders/new', '/app/deliveries', '/app/finance', '/app/people', '/app/settings'],
  ],
};
const only = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const [role, [email, pages]] of Object.entries(roles)) {
    if (only && only !== role) continue;
    for (const [label, vp] of [
      ['desk', { width: 1440, height: 1000 }],
      ['phone', { width: 390, height: 844 }],
    ]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error')
          problems.push(`${role} ${label} ${page.url()} console: ${m.text().slice(0, 200)}`);
      });
      page.on('response', (r) => {
        if (r.url().includes('/api/v1') && r.status() >= 400)
          problems.push(
            `${role} ${label} ${page.url()} ${r.status()} ${r.url().replace('http://localhost:3001/api/v1', '')}`,
          );
      });
      await signIn(page, W, email);
      for (const p of pages) {
        await page.goto(W + p);
        await page.waitForTimeout(1800);
        const name = `${role}-${label}${p.replace(/\//g, '_')}.png`;
        await page.screenshot({ path: require('node:path').join(OUT, name), fullPage: true });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        if (overflow) problems.push(`${role} ${label} ${p} horizontal page scroll`);
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(problems.join('\n') || 'no problems');
})();
