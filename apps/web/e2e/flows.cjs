// Browser checks against a running web app (pnpm dev) with demo data (node scripts/demo-data.mjs).
// Uses the preinstalled Playwright; screenshots go to SHOTS_DIR (default: the temp folder).
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ?? require('node:os').tmpdir();
const W0 = process.env.WEB_URL;
const W = W0 ?? 'http://localhost:3000';
const log = (...a) => console.log(...a);
async function as(b, email, vp = { width: 1280, height: 900 }) {
  const page = await (await b.newContext({ viewport: vp })).newPage();
  page.on('response', (r) => {
    if (r.url().includes('/api/v1') && r.status() >= 400)
      log('  API', r.status(), r.request().method(), r.url().split('/api/v1')[1]);
  });
  await page.goto(`${W}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'Password123!');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/app');
  return page;
}
(async () => {
  const b = await chromium.launch();
  // 1. Admin records City Cafe's delivery and completes it.
  const admin = await as(b, 'admin@sunrise.test');
  await admin.goto(`${W}/app/deliveries`);
  await admin.waitForTimeout(1500);
  await admin.click('button:has-text("City Cafe")');
  await admin.waitForSelector('text=Delivery completed');
  const first = admin.locator('input[aria-label$="delivered"]').first();
  const v = Number(await first.inputValue());
  await first.fill(String(v + 2));
  await admin.click('button:has-text("Delivery completed")');
  await admin.waitForSelector('.card >> text=Waiting for contractor', { timeout: 8000 });
  log('1 delivery completed; difference shown:', await admin.locator('.flag').first().innerText());
  await admin.screenshot({
    path: require('node:path').join(OUT, 'flow-delivery.png'),
    fullPage: true,
  });
  // 2. City Cafe confirms.
  const cafe = await as(b, 'admin@citycafe.test', { width: 390, height: 844 });
  await cafe.goto(`${W}/app/deliveries`);
  await cafe.waitForSelector('text=Confirm delivery');
  await cafe.click('text=Confirm delivery');
  await cafe.waitForSelector('text=Confirmed');
  log('2 contractor confirmed');
  await cafe.screenshot({
    path: require('node:path').join(OUT, 'flow-cafe-confirmed.png'),
    fullPage: true,
  });
  // 3. Admin creates a task for Mina.
  await admin.goto(`${W}/app/tasks`);
  await admin.click('button:has-text("New task")');
  await admin.fill('label:has-text("Title") input', 'Wipe the oven doors');
  const opts = await admin.locator('label:has-text("For") select option').allInnerTexts();
  await admin.selectOption('label:has-text("For") select', { label: 'Mina Park' });
  await admin.click('button:has-text("Create task")');
  await admin.waitForSelector('h2:has-text("Wipe the oven doors")');
  log('3 task created; assignee options:', opts.join(', '));
  // 4. Mina finishes it with the camera.
  const mina = await as(b, 'mina@sunrise.test', { width: 390, height: 844 });
  await mina.goto(`${W}/app/tasks`);
  await mina.waitForSelector('text=Take photo and finish');
  const capture = await mina.locator('input[type=file]').first().getAttribute('capture');
  const [chooser] = await Promise.all([
    mina.waitForEvent('filechooser'),
    mina.click('button:has-text("Take photo and finish")'),
  ]);
  await chooser.setFiles(require('node:path').join(__dirname, '../public/logo.png'));
  await mina.waitForTimeout(2500);
  await mina.click('[role=tab]:has-text("Done")');
  await mina.waitForSelector('img.photo', { timeout: 8000 });
  log('4 task done with photo; input capture =', capture);
  await mina.screenshot({
    path: require('node:path').join(OUT, 'flow-task-done.png'),
    fullPage: true,
  });
  // 5. Mina accepts the added Baguettes; the decrease waits for an admin.
  await mina.goto(`${W}/app/orders`);
  await mina.waitForSelector('text=Order changes waiting');
  await mina.click('button:has-text("Accept")');
  await mina.waitForTimeout(1500);
  log(
    '5 employee accepted addition; admin-only left:',
    await mina.locator('text=Waiting for an admin').count(),
  );
  // 6. Green Deli places an order.
  const deli = await as(b, 'admin@greendeli.test', { width: 390, height: 844 });
  await deli.goto(`${W}/app/orders/new`);
  await deli.waitForSelector('input[aria-label="Bagel quantity"]');
  if (await deli.locator('text=Yes, today').count()) await deli.click('text=No, tomorrow');
  const d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await deli.fill('input[type=date]', d);
  await deli.fill('input[aria-label="Bagel quantity"]', '12');
  await deli.fill('input[aria-label="Scone quantity"]', '6');
  await deli.click('button:has-text("Place order")');
  await deli.waitForURL('**/app');
  await deli.waitForTimeout(1500);
  log('6 order placed:', (await deli.locator('section.card h2').allInnerTexts()).join(' | '));
  await deli.screenshot({
    path: require('node:path').join(OUT, 'flow-deli-orders.png'),
    fullPage: true,
  });
  await b.close();
})().catch((e) => {
  console.error('FAILED', e.message.slice(0, 400));
  process.exit(1);
});
