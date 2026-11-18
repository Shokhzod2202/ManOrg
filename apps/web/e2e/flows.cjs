// Browser checks against a running web app (pnpm dev) with demo data (node scripts/demo-data.mjs).
// Uses the preinstalled Playwright; screenshots go to SHOTS_DIR (default: the temp folder).
const { chromium } = require('playwright');
const { signIn } = require('./sign-in.cjs');
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
  await signIn(page, W, email);
  return page;
}
(async () => {
  const b = await chromium.launch();
  // 1. Admin records City Cafe's delivery and completes it.
  const admin = await as(b, 'admin@sunrise.test');
  await admin.goto(`${W}/app/deliveries`);
  await admin.waitForTimeout(1500);
  // Any contractor whose delivery is still open; the check can be re-run on the same data.
  const LOGINS = {
    'City Cafe': 'admin@citycafe.test',
    'Green Deli': 'admin@greendeli.test',
    'Hotel Lumi': 'admin@lumi.test',
    'Mart 24': 'admin@mart24.test',
  };
  let picked = null;
  for (const name of Object.keys(LOGINS)) {
    const button = admin.locator(`button:has-text("${name}")`);
    if (!(await button.count())) continue;
    await button.first().click();
    await admin.waitForTimeout(1200);
    if (await admin.locator('button:has-text("Delivery completed")').count()) {
      picked = name;
      break;
    }
  }
  if (!picked) throw new Error('No open delivery left: run the demo data script again.');
  log('1 recording delivery for', picked);
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
  const cafe = await as(b, LOGINS[picked], { width: 390, height: 844 });
  await cafe.goto(`${W}/app/deliveries`);
  await cafe.waitForSelector('text=Confirm delivery');
  await cafe.locator('text=Confirm delivery').first().click();
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
  // 5. A contractor with an open order asks to add a product; Mina accepts the addition.
  let lumi = null;
  let other = null;
  for (const name of Object.keys(LOGINS)) {
    if (name === picked) continue;
    const p = await as(b, LOGINS[name], { width: 390, height: 844 });
    await p.waitForTimeout(1500);
    if (await p.locator('button:has-text("Request a change")').count()) {
      lumi = p;
      other = name;
      break;
    }
    await p.context().close();
  }
  if (!lumi) throw new Error('No contractor has an open order: run the demo data script again.');
  await lumi.locator('button:has-text("Request a change")').first().click();
  const addSelect = lumi.locator('select[aria-label="Add a product…"]');
  const options = await addSelect.locator('option').allInnerTexts();
  await addSelect.selectOption({ label: options[1] });
  await lumi.click('button:has-text("Send request")');
  await lumi.waitForSelector('text=Change waiting');
  log('5a', other, 'asked to add', options[1]);
  await mina.goto(`${W}/app/orders`);
  await mina.waitForSelector('text=Order changes waiting');
  const before = await mina.locator('button:has-text("Accept")').count();
  await mina.locator('button:has-text("Accept")').first().click();
  await mina.waitForTimeout(1500);
  log(
    '5b employee accepted an addition:',
    before,
    '->',
    await mina.locator('button:has-text("Accept")').count(),
    'accept buttons; admin-only waiting:',
    await mina.locator('text=Waiting for an admin').count(),
  );
  // 6. Green Deli places an order.
  const deli = await as(b, 'admin@greendeli.test', { width: 390, height: 844 });
  await deli.goto(`${W}/app/orders/new`);
  await deli.waitForSelector('input[aria-label="Bagel quantity"]');
  if (await deli.locator('text=Yes, today').count()) await deli.click('text=No, tomorrow');
  await deli.fill('input[aria-label="Bagel quantity"]', '12');
  await deli.fill('input[aria-label="Scone quantity"]', '6');
  // One order per contractor per day: try the following days until one is free.
  for (let days = 3; ; days += 1) {
    if (days > 40) throw new Error('No free delivery date found');
    await deli.fill(
      'input[type=date]',
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
    );
    await deli.click('button:has-text("Place order")');
    const placed = await deli.waitForURL('**/app', { timeout: 4000 }).then(
      () => true,
      () => false,
    );
    if (placed) break;
  }
  await deli.waitForTimeout(1500);
  log('6 order placed:', (await deli.locator('section.card h2').allInnerTexts()).join(' | '));
  await deli.screenshot({
    path: require('node:path').join(OUT, 'flow-deli-orders.png'),
    fullPage: true,
  });
  // 7. A visitor lands on the landing page (ACC-1); signed-in tokens never reach page scripts.
  const visitor = await (await b.newContext()).newPage();
  await visitor.goto(W);
  await visitor.waitForSelector('text=Create account');
  log('7 visitor sees landing page:', await visitor.locator('h1').innerText());
  const exposed = await admin.evaluate(() => ({
    cookie: document.cookie.includes('manorg_rt'),
    stored: Object.keys(localStorage).filter((k) => k.includes('token')),
  }));
  const cookies = await admin.context().cookies();
  const rt = cookies.find((c) => c.name === 'manorg_rt');
  log(
    '7 refresh cookie httpOnly:',
    rt?.httpOnly,
    'sameSite:',
    rt?.sameSite,
    '| visible to scripts:',
    exposed.cookie,
    '| tokens in storage:',
    exposed.stored.length,
  );
  if (!rt?.httpOnly || exposed.cookie || exposed.stored.length)
    throw new Error('Session token exposed to page scripts');

  // 8. Orders: Mine for an employee (TOD-5), By day with production totals for the admin (ORD-4).
  await mina.goto(`${W}/app/orders`);
  await mina.click('[role=tab]:has-text("Mine")');
  await mina.waitForTimeout(1500);
  const mineCount = await mina.locator('.tile').count();
  await mina.click('[role=tab]:has-text("All")');
  await mina.waitForTimeout(1500);
  log('8 Mine shows', mineCount, 'products; All shows', await mina.locator('.tile').count());
  await admin.goto(`${W}/app/orders`);
  await admin.click('[role=tab]:has-text("By day")');
  await admin.waitForSelector('text=Production totals', { timeout: 10000 }).catch(() => null);
  log('8 By day shows totals:', (await admin.locator('text=Production totals').count()) > 0);

  // 9. Admin adds a missing punch for Joon yesterday, then corrects it (SHF-4).
  await admin.goto(`${W}/app/shifts`);
  await admin.selectOption('#punch-editor select[aria-label="Employee"]', { label: 'Joon Kim' });
  const yesterday = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  await admin.fill('#punch-editor input[aria-label="Shift date"]', yesterday);
  await admin.waitForTimeout(1500);
  if (!(await admin.locator('#punch-editor input[aria-label="Start time"]').count())) {
    await admin.selectOption('#punch-editor select[aria-label="Punch type"]', 'start');
    await admin.fill('#punch-editor input[aria-label="Punch time"]', `${yesterday}T06:05`);
    await admin.click('#punch-editor button:has-text("Add")');
    await admin.waitForSelector('text=Punch added.');
  }
  const startInput = admin.locator('#punch-editor input[aria-label="Start time"]').first();
  const was = await startInput.inputValue();
  const earlier = new Date(Date.parse(`${was}:00Z`) - 60_000).toISOString().slice(0, 16);
  await startInput.fill(earlier);
  await admin.click('#punch-editor button:has-text("Save")');
  await admin.waitForSelector('text=Punch corrected.');
  log('9 punch added and corrected from', was, 'to', earlier);

  // 10. Mina builds her own team (OUT-4, OUT-5).
  await mina.goto(`${W}/app/output`);
  await mina.click('button:has-text("New team")');
  await mina.fill('label:has-text("Team name") input', `Pair ${Date.now() % 1000}`);
  await mina.locator('.chip input[type=checkbox]').first().check();
  await mina.click('button:has-text("Save team")');
  await mina.waitForTimeout(1500);
  log(
    '10 Mina teams now:',
    (await mina.locator('section:has(h2:has-text("My teams")) b').allInnerTexts()).join(', '),
  );

  // 10b. The admin switches an Employee access area on and off again (saved on the server).
  await admin.goto(`${W}/app/settings`);
  const area = admin
    .locator('section:has(h2:has-text("Employee access")) input[role=switch]')
    .nth(2);
  await area.waitFor();
  const switchWas = await area.isChecked();
  await area.click();
  await admin.waitForTimeout(1200);
  await admin.reload();
  const area2 = admin
    .locator('section:has(h2:has-text("Employee access")) input[role=switch]')
    .nth(2);
  await area2.waitFor();
  const saved = await area2.isChecked();
  await area2.click();
  await admin.waitForTimeout(1200);
  log('10b Employee access switch saved:', saved !== switchWas);
  if (saved === switchWas) throw new Error('Employee access switch did not save');

  // 11. Signing out ends the session on the server too: the old refresh token is refused.
  await admin.goto(`${W}/app/more`);
  const oldToken = (await admin.context().cookies()).find((c) => c.name === 'manorg_rt')?.value;
  await admin.click('button:has-text("Sign out")');
  await admin.waitForURL(`${W}/`);
  const cookieGone = !(await admin.context().cookies()).some(
    (c) => c.name === 'manorg_rt' && c.value,
  );
  const replay = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/api/v1/auth/refresh`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: oldToken }),
    },
  );
  log('11 after sign-out: cookie removed', cookieGone, '| old token replayed ->', replay.status);
  if (!cookieGone || replay.status !== 401) throw new Error('Session still alive after sign-out');
  // 12. Inside the phone app (simulated bridge): sign-in hands the app its own working session.
  const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await phoneCtx.addInitScript(() => {
    window.__phone = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__phone.push(JSON.parse(m)) };
  });
  const phone = await phoneCtx.newPage();
  await signIn(phone, W, 'mina@sunrise.test');
  await phone.waitForFunction(() => window.__phone.some((m) => m.type === 'session'), null, {
    timeout: 15000,
  });
  const handed = (await phone.evaluate(() => window.__phone)).find((m) => m.type === 'session');
  const deviceRefresh = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/api/v1/auth/refresh`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: handed.refreshToken }),
    },
  );
  log(
    '12 phone app got a session for org',
    Boolean(handed.orgId),
    '| it refreshes:',
    deviceRefresh.status,
  );
  if (deviceRefresh.status !== 200) throw new Error('Device session does not work');
  await phone.goto(`${W}/app/more`);
  await phone.click('button:has-text("Sign out") >> visible=true');
  await phone.waitForFunction(() => window.__phone.some((m) => m.type === 'signed-out'));
  log('12 phone app told about sign-out');

  // 13. The admin sets the bakery location; the employee sees the arrival reminder switch.
  const boss = await as(b, 'admin@sunrise.test');
  await boss.goto(`${W}/app/settings`);
  await boss.waitForSelector('h2:has-text("Bakery location")');
  await boss.fill('label:has-text("Latitude") input', '37.566500');
  await boss.fill('label:has-text("Longitude") input', '126.978000');
  await boss.click('button:has-text("Save location")');
  await boss.waitForSelector('text=Saved.');
  const sw = boss.locator('section:has(h2:has-text("Bakery location")) input[role=switch]');
  if (!(await sw.isChecked())) await sw.click();
  await boss.waitForTimeout(1000);
  log('13 arrival reminder on:', await sw.isChecked());
  await mina.goto(`${W}/app/settings`);
  await mina.waitForSelector('h2:has-text("Arrival reminder")');
  log(
    '13 employee switch shown, on by default:',
    await mina
      .locator('section:has(h2:has-text("Arrival reminder")) input[role=switch]')
      .isChecked(),
  );

  // 14. The AI bot (only when a model is configured): preview first, applied on Confirm.
  await boss.goto(`${W}/app/bot`);
  await boss.waitForSelector('h1:has-text("Bot")');
  if (await boss.locator('textarea[aria-label="Message"]').count()) {
    await boss.fill('textarea[aria-label="Message"]', 'Add ingredient rye flour, 1500 won, 20 kg');
    await boss.click('button:has-text("Send")');
    await boss.waitForSelector('.proposal', { timeout: 30000 });
    await boss.click('.proposal >> nth=-1 >> button:has-text("Confirm")');
    await boss.waitForSelector('.proposal >> nth=-1 >> text=Applied');
    log('14 bot proposal confirmed and applied');
  } else {
    log('14 bot not configured on this server (skipped)');
  }

  // 15. Money (F-001): the contractor confirms a payment with proof; the admin approves and
  // allocates it oldest first; the outstanding balance drops by that amount.
  const contractorPage = await as(b, LOGINS[picked]);
  await contractorPage.goto(`${W}/app/finance`);
  await contractorPage.waitForSelector('text=Outstanding now');
  await contractorPage.click('[role=tab]:has-text("Payments")');
  await contractorPage.waitForSelector('text=Confirm a payment');
  const owedText = await contractorPage.locator('p:has-text("Outstanding now") b').innerText();
  const owed = Number(owedText.replace(/[^0-9]/g, ''));
  const paying = Math.min(1000, owed);
  if (paying > 0) {
    await contractorPage.fill('label:has-text("Amount paid") input', String(paying));
    await contractorPage.setInputFiles(
      'input[type=file]',
      require('node:path').join(__dirname, '../public/logo.png'),
    );
    await contractorPage.click('button:has-text("Send to the bakery")');
    await contractorPage.waitForSelector('text=Waiting for review');
    await boss.goto(`${W}/app/finance`);
    await boss.click('[role=tab]:has-text("Payments")');
    await boss.waitForSelector('button:has-text("Review")');
    await boss.locator('button:has-text("Review")').first().click();
    await boss.waitForSelector('text=Allocated');
    await boss.fill('label:has-text("Approved amount") input', String(paying));
    await boss.click('button:has-text("Oldest first")');
    await boss.click('form button:has-text("Approve")');
    await boss.waitForTimeout(1500);
    await contractorPage.reload();
    await contractorPage.click('[role=tab]:has-text("Payments")');
    await contractorPage.waitForSelector('text=Approved');
    const after = Number(
      (await contractorPage.locator('p:has-text("Outstanding now") b').innerText()).replace(
        /[^0-9]/g,
        '',
      ),
    );
    log('15 payment of', paying, 'approved; outstanding', owed, '->', after);
    if (after !== owed - paying)
      throw new Error('Outstanding did not drop by the approved payment');
  } else {
    log('15 nothing outstanding (skipped)');
  }
  // The admin fills a default settlement schedule for that contractor.
  await boss.goto(`${W}/app/finance`);
  await boss.click('[role=tab]:has-text("Settlement")');
  await boss.selectOption('select[aria-label="Contractor"]', { label: picked });
  await boss.waitForSelector('text=Fill 1–15 and 16–end');
  await boss.click('button:has-text("Fill 1–15 and 16–end")');
  await boss.click('button:has-text("Save schedule")');
  const scheduleSaved = await boss
    .waitForSelector('text=Saved. Closed periods are unchanged.', { timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  log('15 settlement schedule saved:', scheduleSaved);
  if (!scheduleSaved) throw new Error('Settlement schedule did not save');

  // 16. Phase 3 repeating task: the admin makes a daily task for Mina; today's task appears at once.
  const rule = `Sweep the flour room ${Date.now() % 100000}`;
  await boss.goto(`${W}/app/tasks`);
  await boss.click('button:has-text("New task")');
  await boss.fill('label:has-text("Title") input', rule);
  await boss.selectOption('label:has-text("For") select', { label: 'Mina Park' });
  await boss.selectOption('label:has-text("Repeat") select', 'daily');
  await boss.click('button:has-text("Start repeating task")');
  await boss.click('[role=tab]:has-text("Repeating")');
  await boss.waitForSelector(`h2:has-text("${rule}")`);
  const ruleText = await boss.locator('section', { hasText: rule }).first().innerText();
  await mina.goto(`${W}/app/tasks`);
  await mina.waitForSelector(`h2:has-text("${rule}")`);
  const badge = await mina.locator('h2', { hasText: rule }).locator('.pill').innerText();
  log(
    '16 repeating task:',
    ruleText.split('\n').slice(1, 2).join(' '),
    '| Mina sees it, badge:',
    badge,
  );
  if (!/Every day/.test(ruleText) || badge !== 'Repeats')
    throw new Error('Repeating task not shown');

  // 17. Phase 3 languages: Mina switches to Korean in Settings; it stays after a reload because it
  // is saved to her account, and she switches back to English.
  await mina.goto(`${W}/app/settings`);
  await mina.selectOption('select[aria-label="Language"]', 'ko');
  await mina.waitForSelector('h1:has-text("설정")');
  await mina.reload();
  await mina.waitForSelector('h1:has-text("설정")', { timeout: 10000 });
  await mina.goto(`${W}/app`);
  const tab = await mina.locator('nav.tabbar a').first().innerText();
  await mina.screenshot({ path: require('node:path').join(OUT, 'flow-korean-home.png') });
  await mina.goto(`${W}/app/settings`);
  await mina.selectOption('select[aria-label="언어"]', 'en');
  await mina.waitForSelector('h1:has-text("Settings")');
  log('17 Korean kept after reload; first tab reads', JSON.stringify(tab), '| back to English');

  await b.close();
})().catch((e) => {
  console.error('FAILED', e.message.slice(0, 400));
  process.exit(1);
});
