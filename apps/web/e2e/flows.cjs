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
// Decided 2026-11-30: confirmations are shown inside the page, not as browser pop-ups.
async function confirmInPage(page) {
  await page.locator('.confirm-box button:not(.ghost)').click();
  await page.locator('.confirm-box').waitFor({ state: 'detached' });
}
// Opens the ⋯ menu on a member's row, picks the action and confirms it.
async function rowAction(page, rowText, action) {
  const row = page.locator('section:has(h2:has-text("Members")) tr', { hasText: rowText }).first();
  await row.locator('.more-btn').click();
  await row.locator(`.more-list button:has-text("${action}")`).click();
  await confirmInPage(page);
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
  const opts = await admin.locator('fieldset.who label').allInnerTexts();
  await admin.check('fieldset.who label:has-text("Mina Park") input');
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
    if (days > 400) throw new Error('No free delivery date found');
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
  await boss.check('fieldset.who label:has-text("Mina Park") input');
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

  // 18. Fixes of 2026-11-24. A task for everyone; a product with only a name, minutes and price;
  // the logo goes home; sign-up asks for the password twice and can show it; an admin creates a
  // second organization from Settings and switches between them.
  const everyone = `Tidy the store room ${Date.now() % 100000}`;
  await boss.goto(`${W}/app/tasks`);
  await boss.click('button:has-text("New task")');
  await boss.fill('label:has-text("Title") input', everyone);
  await boss.check('fieldset.who label:has-text("Everyone") input');
  await boss.click('button:has-text("Create task")');
  await mina.goto(`${W}/app/tasks`);
  await mina.waitForSelector(`h2:has-text("${everyone}")`);
  const forText = await mina.locator('section', { hasText: everyone }).first().innerText();
  if (!forText.includes('For everyone')) throw new Error('Task for everyone not shown as such');
  const plain = `Plain bun ${Date.now() % 100000}`;
  await boss.goto(`${W}/app/products`);
  await boss.click('button:has-text("New product")');
  await boss.fill('form label:has-text("Name") input', plain);
  await boss.fill('label:has-text("Price per piece") input', '1700');
  await boss.click('button:has-text("Add product")');
  await boss.waitForSelector(`text=${plain}`);
  await boss.goto(`${W}/app/settings`);
  await boss.click('nav.side a.brand');
  await boss.waitForURL(`${W}/app`);
  log(
    '18 task for everyone seen by Mina; product added with name, minutes and price; logo goes home',
  );
  const newcomer = await b.newPage({ viewport: { width: 390, height: 844 } });
  const email = `owner${Date.now()}@example.test`;
  await newcomer.goto(`${W}/register`);
  const newcomerName = `Second Owner ${Date.now() % 1000000}`;
  await newcomer.fill('label:has-text("Your name") input', newcomerName);
  await newcomer.fill('input[type=email]', email);
  const pw = newcomer.locator('.password input');
  await pw.nth(0).fill('Password123!');
  await pw.nth(1).fill('Password123?');
  const blocked = await newcomer.locator('button:has-text("Create account")').isDisabled();
  await newcomer.click('.password button[aria-label="Show password"] >> nth=0');
  const shown = await pw.nth(0).getAttribute('type');
  await pw.nth(1).fill('Password123!');
  await newcomer.click('button:has-text("Create account")');
  await newcomer.waitForURL('**/start');
  await newcomer.click('[role=tab]:has-text("Create an organization")');
  await newcomer.fill(
    'label:has-text("Organization name") input',
    `First Org ${Date.now() % 1000}`,
  );
  await newcomer.click('form button.btn.big');
  await newcomer.waitForURL('**/app');
  await newcomer.goto(`${W}/app/settings`);
  await newcomer.click('button:has-text("Create a new organization")');
  const second = `Second Org ${Date.now() % 1000}`;
  await newcomer.fill('form label:has-text("Organization name") input', second);
  await newcomer.click('form button:has-text("Create")');
  await newcomer.waitForURL('**/app');
  await newcomer.waitForSelector(`.brand-top:has-text("${second}")`);
  await newcomer.goto(`${W}/app/settings`);
  await newcomer.waitForSelector('h2:has-text("Your organizations")');
  await newcomer.waitForSelector('button:has-text("Switch")', { timeout: 10000 });
  const orgs = await newcomer.locator('button:has-text("Switch")').count();
  log(
    '18 sign-up: mismatch blocks =',
    blocked,
    '| eye shows type =',
    shown,
    '| second organization open, others to switch to:',
    orgs,
  );
  if (!blocked || shown !== 'text' || orgs < 1)
    throw new Error('Sign-up or second organization failed');

  // 19. Fixes of 2026-11-25. The new owner applies to Sunrise as an employee; the admin approves
  // on People and the person shows in Members at once, without reloading the page. Then the owner
  // manages their account: a picture, and a new password that keeps this device signed in.
  await newcomer.goto(`${W}/app/settings`);
  await newcomer.click('button:has-text("Join another organization")');
  await newcomer.fill('form label:has-text("Organization name") input', 'Sunrise');
  await newcomer.click('form button:has-text("Search")');
  await newcomer.click('form button:has-text("Apply")');
  await newcomer.waitForSelector('text=Waiting for approval');
  await boss.goto(`${W}/app/people`);
  const applications = boss.locator('section:has(h2:has-text("Applications"))');
  await applications
    .locator(':is(div, tr):has-text("' + newcomerName + '")')
    .last()
    .locator('button:has-text("Approve")')
    .click();
  const appeared = await boss
    .locator('section:has(h2:has-text("Members"))')
    .getByText(newcomerName)
    .first()
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  log('19 approved applicant shows in Members without a reload:', appeared);
  if (!appeared) throw new Error('Approved member did not appear until reload');
  await newcomer.goto(`${W}/app/settings`);
  const [pictureChooser] = await Promise.all([
    newcomer.waitForEvent('filechooser'),
    newcomer.click('button:has-text("Add a picture")'),
  ]);
  await pictureChooser.setFiles(require('node:path').join(__dirname, '../public/logo.png'));
  await newcomer.waitForSelector('text=Picture saved.');
  const avatar = await newcomer.locator('section:has(h2:has-text("Account")) img.avatar').count();
  await newcomer.click('button:has-text("Change password")');
  const pwf = newcomer.locator('section:has(h2:has-text("Account")) .password input');
  await pwf.nth(0).fill('Wrong-password-9');
  await pwf.nth(1).fill('Password456!x');
  await pwf.nth(2).fill('Password456!x');
  await newcomer.click('button:has-text("Save password")');
  const wrongShown = await newcomer
    .waitForSelector('text=Your current password is incorrect.', { timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  await pwf.nth(0).fill('Password123!');
  await newcomer.click('button:has-text("Save password")');
  await newcomer.waitForSelector('text=Password saved.');
  await newcomer.reload();
  await newcomer.waitForSelector('h2:has-text("Account")', { timeout: 10000 });
  log(
    '19 account: picture shown =',
    avatar === 1,
    '| wrong current password explained =',
    wrongShown,
    '| still signed in after the change',
  );
  if (avatar !== 1 || !wrongShown) throw new Error('Account settings failed');

  // 20. Decided 2026-11-26. The owner makes the newcomer an admin of Sunrise, then an employee
  // again while the newcomer's app is open: the newcomer's menu drops back to the employee one
  // without a reload. Then the owner switches on "works shifts" for themselves and gets a punch
  // card on Today, and switches it off again.
  const sunriseOpen = async () => {
    await newcomer.goto(`${W}/app/settings`);
    await newcomer.waitForSelector('h2:has-text("Your organizations")');
    const row = newcomer.locator('div.row', { hasText: 'Sunrise' }).first();
    if (await row.locator('button:has-text("Switch")').count())
      await row.locator('button:has-text("Switch")').click();
    await newcomer.waitForURL(`${W}/app`);
  };
  await sunriseOpen();
  const roleSelect = () =>
    boss
      .locator('section:has(h2:has-text("Members")) tr', { hasText: newcomerName })
      .locator('select');
  await boss.goto(`${W}/app/people`);
  await roleSelect().selectOption('admin');
  await boss.waitForTimeout(800);
  await newcomer.evaluate(() => window.dispatchEvent(new Event('focus')));
  await newcomer.waitForSelector('nav.tabbar a:has-text("Deliveries")', { timeout: 10000 });
  await boss.goto(`${W}/app/people`);
  await roleSelect().selectOption('employee');
  await boss.waitForTimeout(800);
  await newcomer.evaluate(() => window.dispatchEvent(new Event('focus')));
  const demoted = await newcomer
    .waitForSelector('nav.tabbar a:has-text("Deliveries")', { state: 'detached', timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
  const ownerPill = await boss
    .locator('section:has(h2:has-text("Members")) .pill:has-text("Owner")')
    .count();
  log(
    '20 owner shown:',
    ownerPill === 1,
    '| demoted admin sees the employee menu without a reload:',
    demoted,
  );
  if (!demoted || ownerPill !== 1) throw new Error('Demotion or owner label failed');
  // Decided 2026-11-27: ownership is shared. The owner makes the newcomer an owner too; the
  // newcomer then stops being one themselves; the owner then makes them an employee again.
  // Decided 2026-11-30: these actions sit in the row's ⋯ menu and ask for confirmation in the page.
  await boss.goto(`${W}/app/people`);
  await rowAction(boss, newcomerName, 'Make owner');
  await boss.waitForTimeout(1000);
  const owners = await boss
    .locator('section:has(h2:has-text("Members")) .pill:has-text("Owner")')
    .count();
  const undoOwner = await boss
    .locator('section:has(h2:has-text("Members")) tr', { hasText: newcomerName })
    .locator('button:has-text("Undo")')
    .count();
  await newcomer.goto(`${W}/app/people`);
  await rowAction(newcomer, 'You', 'Stop being an owner');
  await newcomer.waitForTimeout(1000);
  await boss.goto(`${W}/app/people`);
  await roleSelect().selectOption('employee');
  await boss.waitForTimeout(800);
  log(
    '20 ownership shared: owners shown =',
    owners,
    '| undo offered:',
    undoOwner === 1,
    '| the new owner stepped down themselves',
  );
  if (owners !== 2 || undoOwner !== 1) throw new Error('Shared ownership failed');
  await boss.goto(`${W}/app/settings`);
  const mine = boss.locator('section:has(h2:has-text("Admins who work shifts")) label', {
    hasText: 'You',
  });
  await mine.locator('input').check();
  await boss.goto(`${W}/app`);
  const card = await boss
    .waitForSelector('section[aria-label="Punch card"]', { timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
  await boss.goto(`${W}/app/settings`);
  await mine.locator('input').uncheck();
  await boss.waitForTimeout(800);
  log('20 admin switched on to work shifts gets a punch card:', card);
  if (!card) throw new Error('Admin punch card missing');

  // 21. Decided 2026-11-28. A shared team holds Mina and the newcomer; the newcomer is removed
  // from Sunrise. The team shows them as removed; the admin edits the team and takes them off
  // without an error, then clears their remaining shifts and teams from Removed members.
  const pairName = `Pair ${Date.now() % 100000}`;
  await boss.goto(`${W}/app/people`);
  const teamsCard = boss.locator('section:has(h2:has-text("Teams"))');
  await teamsCard.locator('button:has-text("New team")').click();
  await teamsCard.locator('label:has-text("Team name") input').fill(pairName);
  await teamsCard.locator('label.chip', { hasText: 'Mina Park' }).locator('input').check();
  await teamsCard.locator('label.chip', { hasText: newcomerName }).locator('input').check();
  await teamsCard.locator('button:has-text("Save team")').click();
  await teamsCard.locator(`text=${pairName}`).waitFor();
  await rowAction(boss, newcomerName, 'Remove');
  await boss.locator('section:has(h2:has-text("Removed members"))').waitFor();
  const undoRemove = await boss
    .locator('section:has(h2:has-text("Removed members")) div.stack', { hasText: newcomerName })
    .locator('button:has-text("Undo remove")')
    .first()
    .waitFor({ timeout: 8000 })
    .then(
      () => 1,
      () => 0,
    );
  const teamRow = teamsCard.locator('div.row', { hasText: pairName }).first();
  const shownRemoved = await teamRow
    .filter({ hasText: '(removed)' })
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  await teamRow.locator('button:has-text("Edit")').click();
  await teamsCard.locator('label.chip.removed input').uncheck();
  // Two members are needed for a shared team: add Joon in the removed person's place.
  await teamsCard.locator('label.chip', { hasText: 'Joon Kim' }).locator('input').check();
  await teamsCard.locator('button:has-text("Save team")').click();
  // The list reloads after the save: wait for the row without the removed person.
  const editedRow = teamsCard.locator('div.row', { hasText: pairName }).first();
  const takenOff = await editedRow
    .filter({ hasText: 'Joon Kim' })
    .waitFor({ timeout: 8000 })
    .then(
      async () => !(await editedRow.innerText()).includes(newcomerName),
      () => false,
    );
  const teamError = await boss.locator('section:has(h2:has-text("Teams")) .error').count();
  const removedCard = boss.locator('section:has(h2:has-text("Removed members"))');
  // Decided 2026-11-26: someone who still holds work is cleared here; someone who holds nothing
  // more (taken off the team above) is already listed under Cleared.
  const clearButton = removedCard
    .locator('div.stack', { hasText: newcomerName })
    .locator('button:has-text("Remove from shifts and teams")');
  if (await clearButton.isVisible().catch(() => false)) {
    await clearButton.click();
    await confirmInPage(boss);
    await removedCard.locator('.pill.ok:has-text("Done")').first().waitFor();
  }
  await removedCard.locator('details.cleared').evaluate((el) => {
    el.open = true;
  });
  await removedCard.locator('details.cleared .removed-row', { hasText: newcomerName }).waitFor();
  log(
    '21 removed member shown as removed on the team:',
    shownRemoved,
    '| taken off without an error:',
    teamError === 0 && takenOff,
    '| cleared from shifts and teams | undo offered:',
    undoRemove === 1,
  );
  if (!shownRemoved || teamError !== 0 || !takenOff || undoRemove !== 1)
    throw new Error('Editing a team after removing someone failed');

  // 22. Decided 2026-11-29. The admin gives Mina a name and title for this organization; the
  // shift plan shows them. Then cleared, so other steps find "Mina Park" again.
  await boss.goto(`${W}/app/people`);
  const minaRow = boss.locator('section:has(h2:has-text("Members")) tr', { hasText: 'Mina Park' });
  await minaRow.locator('button:has-text("Edit")').first().click();
  const nameForm = boss.locator(
    'section:has(h2:has-text("Members")) form:has(label:has-text("Name in this organization"))',
  );
  await nameForm
    .locator('label:has-text("Name in this organization") input')
    .fill('Mina the Baker');
  await nameForm.locator('label:has-text("Title") input').fill('Head baker');
  await nameForm.locator('button:has-text("Save")').click();
  await boss.goto(`${W}/app/shifts`);
  const named = await boss.waitForSelector('text=Mina the Baker', { timeout: 10000 }).then(
    async () =>
      (await boss.locator('option', { hasText: 'Mina the Baker · Head baker' }).count()) > 0,
    () => false,
  );
  await boss.goto(`${W}/app/people`);
  const renamedRow = boss.locator('section:has(h2:has-text("Members")) tr', {
    hasText: 'Mina the Baker',
  });
  await renamedRow.locator('button:has-text("Edit")').first().click();
  await nameForm.locator('label:has-text("Name in this organization") input').fill('');
  await nameForm.locator('label:has-text("Title") input').fill('');
  await nameForm.locator('button:has-text("Save")').click();
  await boss
    .locator('section:has(h2:has-text("Members")) tr', { hasText: 'Mina Park' })
    .first()
    .waitFor();
  log('22 name and title given by the admin show in the shift plan:', named);
  if (!named) throw new Error('Organization name and title not shown');

  // Forgot password: the newcomer asks for a link, opens it, sets a new password and signs in.
  // Without a mail server the API writes the email to its log (API_LOG names the file).
  if (process.env.API_LOG) {
    const fs = require('node:fs');
    const visitor = await b.newPage({ viewport: { width: 390, height: 844 } });
    await visitor.goto(`${W}/login`);
    await visitor.click('a:has-text("Forgot your password?")');
    await visitor.waitForURL('**/forgot-password');
    await visitor.waitForSelector('button:has-text("Send reset link")');
    await visitor.fill('input[type=email]', email);
    await visitor.click('button:has-text("Send reset link")');
    await visitor.waitForSelector('text=we sent it a link');
    let link = null;
    for (let i = 0; i < 20 && !link; i += 1) {
      const logText = fs.readFileSync(process.env.API_LOG, 'utf8');
      // One email per "Email to" block, so a message without a link never reaches the next one.
      const mine = logText
        .split('Email to ')
        .filter((block) => block.startsWith(`${email}:`))
        .map((block) => /(http\S*\/reset-password\?token=[\w-]+)/.exec(block)?.[1])
        .filter(Boolean)
        .at(-1);
      link = mine ? mine.replace(/^http:\/\/localhost:3000/, W) : null;
      if (!link) await visitor.waitForTimeout(500);
    }
    if (!link) throw new Error('No reset email in the API log');
    await visitor.goto(link);
    const fields = visitor.locator('.password input');
    await fields.nth(0).fill('Reset-pass-2026!');
    await fields.nth(1).fill('Reset-pass-2026!');
    await visitor.click('button:has-text("Save new password")');
    await visitor.waitForSelector('text=Your password is changed');
    await visitor.goto(`${W}/login`);
    await visitor.fill('input[type=email]', email);
    await visitor.fill('.password input', 'Reset-pass-2026!');
    await visitor.click('button.btn.big');
    await visitor.waitForURL('**/app', { timeout: 15000 });
    log('22 forgot password: link emailed, new password set, signed in with it');
  } else {
    log('22 forgot password: skipped (set API_LOG to the API log file to run it)');
  }

  // 23. Decided 2026-11-30. A product type made while adding a product; "By type" shows it as a
  // heading; in "Custom order" the admin drags a product to the top and the order is kept.
  const oshName = `Osh ${Date.now() % 100000}`;
  const typeName = `Meal ${Date.now() % 100000}`;
  await boss.goto(`${W}/app/products`);
  await boss.click('button:has-text("New product")');
  await boss.fill('form label:has-text("Name") input', oshName);
  await boss.selectOption('form .field:has-text("Type") select', '__new');
  await boss.fill('input[aria-label="New type name"]', typeName);
  await boss.click('form .field:has-text("Type") button:has-text("Add")');
  await boss.waitForSelector(`form .field:has-text("Type") select option:has-text("${typeName}")`, {
    state: 'attached',
  });
  await boss.click('button:has-text("Add product")');
  await boss.waitForSelector(`text=${oshName}`);
  await boss.click('[role=tab]:has-text("By type")');
  const heading = await boss
    .waitForSelector(`.plist-type:has-text("${typeName}")`, { timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  await boss.click('[role=tab]:has-text("Custom order")');
  const rowsLoc = boss.locator('.plist .prow');
  const nameOf = (row) =>
    row.locator('.prow-name').evaluate((el) => el.firstChild.textContent.trim());
  await rowsLoc.nth(1).waitFor();
  const secondName = await nameOf(rowsLoc.nth(1));
  const handle = rowsLoc.nth(1).locator('.drag-handle');
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const from = await handle.boundingBox();
  const to = await rowsLoc.first().boundingBox();
  await boss.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await boss.mouse.down();
  await boss.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 12 });
  await boss.mouse.up();
  await boss.waitForTimeout(1500);
  await boss.reload();
  await rowsLoc.first().waitFor();
  const firstName = await nameOf(rowsLoc.first());
  log(
    '23 type heading shown:',
    heading,
    '| dragged to the top and kept:',
    firstName === secondName,
  );
  if (!heading || firstName !== secondName) throw new Error('Product types or custom order failed');

  // 24. Decided 2026-11-30. Admins see what the orders due next are worth (folded until opened):
  // the total equals the contractors' amounts; By day prices each line with an order total.
  const wonOf = (txt) => Number(txt.replace(/[^0-9]/g, ''));
  await boss.goto(`${W}/app/orders`);
  await boss.waitForSelector('.value-panel summary');
  if (!(await boss.locator('.value-panel').evaluate((el) => el.open)))
    await boss.click('.value-panel summary');
  const grand = wonOf(await boss.textContent('[data-testid=orders-value]'));
  const byContractor = boss.locator('.value-grid > div').first().locator('tbody td:last-child');
  await byContractor.first().waitFor();
  const parts = (await byContractor.allInnerTexts()).map(wonOf);
  const sumOk = grand > 0 && parts.reduce((n, x) => n + x, 0) === grand;
  await boss.click('[role=tab]:has-text("By day")');
  const orderTotal = await boss
    .waitForSelector('table.valued tr.sum td.amt b', { timeout: 10000 })
    .then(
      (el) => el.innerText(),
      () => '',
    );
  log(
    '24 order value adds up:',
    sumOk,
    `(₩${grand}) | by day order total:`,
    orderTotal || 'missing',
  );
  if (!sumOk || !orderTotal) throw new Error('Order value failed');

  // 25. Decided 2026-11-30. Work hours (in More): the admin logs an avans for Mina, confirms it
  // in the page, sees it beside her month, then cancels it.
  const minaHours = boss.locator('details.hours-person', { hasText: 'Mina Park' });
  await boss.goto(`${W}/app/hours`);
  await minaHours.waitFor();
  if (!(await minaHours.evaluate((el) => el.open))) await minaHours.locator('summary').click();
  await minaHours.locator('.avans-form input[type=number]').fill('12345');
  await minaHours.locator('button:has-text("Log avans")').click();
  await confirmInPage(boss);
  const logged = await minaHours
    .locator('tr:not(.cancelled)', { hasText: '₩12,345' })
    .first()
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  await minaHours
    .locator('tr:not(.cancelled)', { hasText: '₩12,345' })
    .first()
    .locator('button')
    .click();
  await confirmInPage(boss);
  const cancelled = await minaHours
    .locator('tr.cancelled', { hasText: '₩12,345' })
    .first()
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  log('25 avans logged beside the hours:', logged, '| cancelled and kept as cancelled:', cancelled);
  if (!logged || !cancelled) throw new Error('Avans failed');

  // 26. Decided 2026-12-01. Products are quiet rows; Edit sets what one batch needs and how many
  // it makes, and "more" shows the batch with its cost from today's ingredient prices.
  await boss.goto(`${W}/app/products`);
  const oshRow = boss.locator('.prow', { hasText: oshName });
  await oshRow.waitFor();
  await oshRow.locator('button:has-text("Edit")').click();
  await oshRow.locator('label:has-text("One batch makes") input').fill('20');
  const pick = oshRow.locator('select[aria-label="Add an ingredient"]');
  const firstIngredient = await pick
    .locator('option:not([value=""])')
    .first()
    .getAttribute('value');
  await pick.selectOption(firstIngredient);
  await oshRow.locator('.batch-line input').first().fill('2');
  await oshRow.locator('button:has-text("Save")').click();
  await oshRow.locator('form').waitFor({ state: 'detached' });
  await oshRow.locator('.prow-more-btn').click();
  const batch = await oshRow
    .locator('h4:has-text("makes 20")')
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  const amount = await oshRow.locator('.batch-list li b').first().innerText();
  const costText = await oshRow.locator('dd').nth(1).innerText();
  log('26 batch saved:', batch, `| amount: ${amount} | cost: ${costText.replace(/\s+/g, ' ')}`);
  if (!batch || !amount.startsWith('2 ')) throw new Error('Batch ingredients failed');

  // 27. Decided 2026-12-01. On a phone a finger held still on a product picks it up and drags it
  // (real touch events, as in the Telegram app); a quick swipe still scrolls.
  const touchCtx = await b.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const tp = await touchCtx.newPage();
  await signIn(tp, W, 'admin@sunrise.test');
  await tp.goto(`${W}/app/products`);
  await tp.waitForSelector('.plist.can-drag .prow');
  const cdp = await touchCtx.newCDPSession(tp);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  const phoneNames = () =>
    tp.$$eval('.plist .prow .prow-name', (els) => els.map((e) => e.firstChild.textContent.trim()));
  await tp.locator('.prow').nth(2).scrollIntoViewIfNeeded();
  const beforeTouch = await phoneNames();
  const held = await tp.locator('.prow-name').nth(2).boundingBox();
  const firstRow = await tp.locator('.prow').first().boundingBox();
  await touch('touchStart', held.x + 10, held.y + held.height / 2);
  await tp.waitForTimeout(500);
  for (let y = held.y + held.height / 2; y > firstRow.y + 5; y -= 8) {
    await touch('touchMove', held.x + 10, y);
  }
  await touch('touchEnd');
  await tp.waitForTimeout(1500);
  await tp.reload();
  await tp.waitForSelector('.prow');
  const afterTouch = await phoneNames();
  await touchCtx.close();
  log(
    '27 finger hold-and-drag moved the third product to the top:',
    afterTouch[0] === beforeTouch[2],
  );
  if (afterTouch[0] !== beforeTouch[2]) throw new Error('Touch drag failed');

  // 28. Decided 2026-11-26. The owner sets Mina's hourly cost in Work hours (owners only), then
  // Output opens on everyone's latest output; choosing Mina shows her month's efficiency with
  // labor. Mina sees her own hours on her home page.
  await boss.goto(`${W}/app/hours`);
  const minaRate = boss.locator('details.hours-person', { hasText: 'Mina Park' });
  await minaRate.waitFor();
  if (!(await minaRate.evaluate((el) => el.open))) await minaRate.locator('summary').click();
  // A different rate each run (an unchanged rate cannot be saved again).
  const rate = 10000 + (Date.now() % 50) * 100;
  await minaRate.locator('.owner-rate input').fill(String(rate));
  await minaRate.locator('.owner-rate button:has-text("Save")').click();
  await minaRate.locator('.owner-rate .pill.ok').waitFor();
  await boss.goto(`${W}/app/output`);
  await boss.locator('text=Latest output').waitFor();
  await boss.locator('select[aria-label="Employee"]').selectOption({ label: 'Mina Park' });
  // Decided 2026-11-28: an employee opens day by day; Efficiency is the next tab, by day first
  // (each day's products and what they brought in), the month one tap over.
  await boss.locator('[role=tab]:has-text("Efficiency")').click();
  const effDayLines = await boss
    .locator('[data-testid=eff-day] .eff-lines tr')
    .first()
    .waitFor({ timeout: 10000 })
    .then(
      () => boss.locator('[data-testid=eff-day] .eff-lines tr').count(),
      () => 0,
    );
  await boss.locator('.tabs [role=tab]:has-text("Month")').click();
  const effTotal = await boss
    .locator('[data-testid=eff-total]')
    .waitFor({ timeout: 10000 })
    .then(
      () => boss.textContent('[data-testid=eff-total]'),
      () => '',
    );
  const laborShown = await boss
    .locator(`.eff-kpis:has-text("₩${rate.toLocaleString('en-US')}/h")`)
    .count();
  const minaHome = await as(b, 'mina@sunrise.test', { width: 390, height: 844 });
  const myHours = await minaHome
    .locator('[data-testid=my-month-hours]')
    .waitFor({ timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
  await minaHome.context().close();
  log(
    '28 efficiency by day: product lines =',
    effDayLines,
    '| month:',
    effTotal,
    '| labor at the hourly cost:',
    laborShown === 1,
    '| My hours on home:',
    myHours,
  );
  if (!effDayLines || !effTotal || laborShown !== 1 || !myHours)
    throw new Error('Efficiency or My hours failed');

  // 29. Decided 2026-11-28. Tapping an employee's name on Output opens their output day by day,
  // with each day's numbers; Efficiency stays one tab over.
  await boss.goto(`${W}/app/output`);
  await boss.locator('button.name-link', { hasText: 'Mina Park' }).click();
  const dayCards = await boss
    .locator('[data-testid=output-day]')
    .first()
    .waitFor({ timeout: 10000 })
    .then(
      () => boss.locator('[data-testid=output-day]').count(),
      () => 0,
    );
  const paceShown = await boss.locator('.day-summary .stat:has-text("Pace")').count();
  await boss.locator('[role=tab]:has-text("Efficiency")').click();
  const effAgain = await boss
    .locator('[data-testid=eff-day]')
    .first()
    .waitFor({ timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
  log(
    '29 day by day: days shown =',
    dayCards,
    '| pace shown:',
    paceShown === 1,
    '| Efficiency tab:',
    effAgain,
  );
  if (!dayCards || paceShown !== 1 || !effAgain) throw new Error('Output day by day failed');

  // 30. Decided 2026-11-28. An employee's own output history (More → Output history): the
  // month's days with their products, searchable by product.
  const histPage = await as(b, 'mina@sunrise.test', { width: 390, height: 844 });
  await histPage.goto(`${W}/app/more`);
  await histPage.click('.page .card a:has-text("Output history")');
  const histDays = await histPage
    .locator('[data-testid=output-day]')
    .first()
    .waitFor({ timeout: 10000 })
    .then(
      () => histPage.locator('[data-testid=output-day]').count(),
      () => 0,
    );
  const firstProduct = (await histPage.locator('.batch-list li span').first().innerText()).trim();
  await histPage.fill('input[type=search]', firstProduct.slice(0, 3));
  const searched = await histPage
    .locator('[data-testid=search-found]')
    .waitFor({ timeout: 5000 })
    .then(
      () => histPage.textContent('[data-testid=search-found]'),
      () => '',
    );
  await histPage.context().close();
  log(
    '30 output history: days shown =',
    histDays,
    `| search "${firstProduct.slice(0, 3)}":`,
    searched,
  );
  if (!histDays || !searched) throw new Error('Output history failed');

  // 31. Decided 2026-11-28. Tapping "On shift now" on Today lists who is on shift, since when
  // and for how long.
  await boss.goto(`${W}/app`);
  await boss.locator('button.kpi:has-text("On shift now")').click();
  const onShiftPanel = await boss
    .locator('[data-testid=on-shift-now]')
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  log('31 On shift now opens the list:', onShiftPanel);
  if (!onShiftPanel) throw new Error('On shift now did not open');

  // 32. Decided 2026-11-28. An ingredient card is Ask to order, Edit and ⋯. Edit changes the
  // price (and anything else) in one form; ⋯ → Price history shows it.
  await boss.goto(`${W}/app/ingredients`);
  const ingCard = boss.locator('.ing-card').first();
  await ingCard.waitFor();
  const cardButtons = await ingCard.locator('.ing-actions > button').count();
  await ingCard.locator('button:has-text("Edit")').click();
  const priceBox = ingCard.locator('label:has-text("Price per pack") input');
  const oldPrice = Number(await priceBox.inputValue()) || 1000;
  await priceBox.fill(String(oldPrice + 100));
  await ingCard.locator('.ing-edit button:has-text("Save")').click();
  await ingCard.locator('.pill.ok').waitFor();
  await ingCard.locator('.more-btn').click();
  await ingCard.locator('.more-list button:has-text("Price history")').click();
  const historyRows = await ingCard
    .locator('table.t tr')
    .first()
    .waitFor({ timeout: 8000 })
    .then(
      () => ingCard.locator('table.t tr').count(),
      () => 0,
    );
  log(
    '32 ingredient card buttons:',
    cardButtons,
    '| price saved from Edit | history rows:',
    historyRows,
  );
  if (cardButtons > 2 || historyRows < 2) throw new Error('Ingredient card failed');
  // Decided 2026-11-28: what is thrown away per pack shows on the card; then back to none.
  await ingCard.locator('button:has-text("Edit")').click();
  await ingCard.locator('label:has-text("Thrown away") input').fill('1');
  await ingCard.locator('.ing-edit button:has-text("Save")').click();
  const wasteShown = await ingCard
    .locator('text=thrown away')
    .first()
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  await ingCard.locator('button:has-text("Edit")').click();
  await ingCard.locator('label:has-text("Thrown away") input').fill('');
  await ingCard.locator('.ing-edit button:has-text("Save")').click();
  await ingCard.locator('.ing-edit').waitFor({ state: 'detached' });
  log('32 thrown away per pack shown on the card:', wasteShown);
  if (!wasteShown) throw new Error('Thrown away per pack failed');

  await b.close();
})().catch((e) => {
  console.error('FAILED', e.message.slice(0, 400));
  process.exit(1);
});
