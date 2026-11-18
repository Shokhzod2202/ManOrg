import zlib from 'node:zlib';
// Demo data for local screens and browser checks, created through the public API (never in production).
const B = `${process.env.API_URL ?? 'http://localhost:3001'}/api/v1`;
const PW = 'Password123!';
function crc(buf) {
  let c,
    crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(t, d) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
}
function png(r, g, b) {
  const w = 64,
    h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const shade = (x - 32) ** 2 + (y - 32) ** 2 < 600 ? 1 : 0.85;
      raw[o] = r * shade;
      raw[o + 1] = g * shade;
      raw[o + 2] = b * shade;
    }
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function call(tok, org, method, path, body, form) {
  const h = { Authorization: `Bearer ${tok}` };
  if (org) h['X-Organization-Id'] = org;
  if (body) h['Content-Type'] = 'application/json';
  if (method === 'POST' && path === '/punch') h['Idempotency-Key'] = crypto.randomUUID();
  const r = await fetch(B + path, {
    method,
    headers: h,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
/** Sign-in is rate-limited per minute (spec section 12): wait and retry instead of failing. */
async function auth(path, body) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const r = await fetch(B + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status !== 429) return r;
    console.log('sign-in rate limit reached, waiting 15 s');
    await new Promise((done) => setTimeout(done, 15_000));
  }
  throw new Error(`${path}: still rate-limited`);
}
async function login(email) {
  const r = await auth('/auth/login', { email, password: PW });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return (await r.json()).tokens.accessToken;
}
async function register(name, email) {
  const r = await auth('/auth/register', { name, email, password: PW });
  if (r.ok) return (await r.json()).tokens.accessToken;
  return login(email);
}

const admin = await login('admin@sunrise.test');
const me = await call(admin, null, 'GET', '/me');
const bakery = me.memberships.find((m) => m.organization.type === 'provider').organization.id;
const A = (m, p, b, f) => call(admin, bakery, m, p, b, f);

let ings = (await A('GET', '/ingredients')).items;
if (!ings.length) {
  await A('POST', '/ingredients', {
    name: 'Bread flour',
    source: 'Seoul Flour Co.',
    packQuantity: 20,
    packUnit: 'kg',
    packPrice: 32000,
    orderSchedule: { weekday: new Date().getDay(), time: '18:00' },
  });
  await A('POST', '/ingredients', {
    name: 'Butter',
    source: 'Daily Dairy',
    packQuantity: 5,
    packUnit: 'kg',
    packPrice: 48500,
  });
  ings = (await A('GET', '/ingredients')).items;
}
const names = [
  'Baguette',
  'Croissant',
  'Pain au chocolat',
  'Sourdough loaf',
  'Rye bread',
  'Cinnamon roll',
  'Bagel',
  'Brioche',
  'Ciabatta',
  'Focaccia',
  'Muffin',
  'Danish',
  'Milk bread',
  'Scone',
  'Pretzel',
  'Red bean bun',
  'Garlic bread',
  'Melon pan',
];
const colors = [
  [214, 170, 110],
  [230, 190, 120],
  [150, 100, 70],
  [190, 150, 100],
  [120, 90, 60],
  [200, 140, 90],
  [220, 180, 130],
  [240, 200, 120],
  [210, 190, 160],
  [200, 180, 110],
  [180, 120, 160],
  [230, 170, 90],
  [245, 235, 210],
  [220, 190, 150],
  [160, 100, 50],
  [170, 80, 80],
  [230, 210, 140],
  [200, 220, 120],
];
const existing = (await A('GET', '/products')).items;
const products = [...existing];
for (const [i, n] of names.entries()) {
  if (existing.some((p) => p.name === n)) continue;
  const form = new FormData();
  form.append('file', new Blob([png(...colors[i])], { type: 'image/png' }), `${i}.png`);
  const img = await A('POST', '/product-images', undefined, form);
  products.push(
    await A('POST', '/products', {
      name: n,
      imageKey: img.imageKey,
      minutesPer10: 20 + (i % 5) * 10,
      ingredients: [{ ingredientId: ings[i % ings.length].id }],
    }),
  );
}
// F-001: every product has a price (whole won), or its deliveries cannot be completed.
for (const [i, p] of products.entries()) {
  if (p.unitPrice == null) {
    await A('PUT', `/products/${p.id}/price`, { unitPrice: 1000 + (i % 6) * 500 });
  }
}
console.log('products', products.length);

// More contractors.
const contractors = [
  ['City Cafe', 'admin@citycafe.test', null],
  ['Green Deli', 'admin@greendeli.test', 'Green Deli Admin'],
  ['Hotel Lumi', 'admin@lumi.test', 'Hotel Lumi Admin'],
  ['Mart 24', 'admin@mart24.test', 'Mart 24 Admin'],
];
const times = [
  ['07:00', '08:00'],
  ['08:30', '09:30'],
  ['10:00', '11:00'],
  ['13:00', '14:00'],
];
const ctoks = [];
for (const [org, email, name] of contractors) {
  const tok = name ? await register(name, email) : await login(email);
  let m = (await call(tok, null, 'GET', '/me')).memberships.find(
    (x) => x.organization.type === 'contractor',
  );
  if (!m) {
    const c = await call(tok, null, 'POST', '/organizations', { name: org, type: 'contractor' });
    m = { organization: c.organization };
    await call(tok, c.organization.id, 'POST', `/organizations/${bakery}/applications`);
  }
  ctoks.push([tok, m.organization.id]);
}
for (const a of (await A('GET', '/applications')).items)
  await A('POST', `/applications/${a.id}/approve`);
for (const [i, [, cid]] of ctoks.entries())
  await A('PUT', `/contractors/${cid}/approx-time`, { start: times[i][0], end: times[i][1] });

// Orders for the default date, a different mix per contractor.
const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));
for (const [i, [tok, cid]] of ctoks.entries()) {
  const dd = await call(tok, cid, 'GET', `/orders/default-date?provider_id=${bakery}`);
  const lines = sorted
    .filter((_, j) => (j + i) % (i + 2) !== 0)
    .slice(0, 14 - i)
    .map((p, j) => ({ productId: p.id, quantity: 5 + ((j * 7 + i * 3) % 30) }));
  // Re-runnable: keep one open order per contractor, on the first free date from the default on.
  const until = new Date(Date.parse(`${dd.date}T00:00:00Z`) + 20 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const mine = (await call(tok, cid, 'GET', `/orders?from=${dd.date}&to=${until}`)).items.filter(
    (o) => o.status === 'placed',
  );
  const done = new Set(
    (await call(tok, cid, 'GET', `/deliveries?from=${dd.date}&to=${until}`)).items
      .filter((d) => d.status !== 'not_started' && d.status !== 'draft')
      .map((d) => d.deliveryDate),
  );
  if (mine.some((o) => !done.has(o.deliveryDate))) continue;
  const taken = new Set(mine.map((o) => o.deliveryDate));
  let date = dd.date;
  while (taken.has(date))
    date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  try {
    await call(tok, cid, 'POST', '/orders', { providerId: bakery, deliveryDate: date, lines });
  } catch (e) {
    console.log('order skipped', String(e).slice(0, 120));
  }
}
// A change request from City Cafe.
{
  const [tok, cid] = ctoks[0];
  const dd = await call(tok, cid, 'GET', `/orders/default-date?provider_id=${bakery}`);
  const orders = (await call(tok, cid, 'GET', `/orders?from=${dd.date}&to=${dd.date}`)).items;
  const o = orders[0];
  if (o && !o.openChangeRequestIds.length) {
    const lines = o.lines.map((l, j) => ({
      productId: l.productId,
      quantity: j === 0 ? l.quantity + 10 : j === 1 ? Math.max(1, l.quantity - 3) : l.quantity,
    }));
    // Re-runs: a delivered order takes no changes (409); that is fine for demo data.
    await call(tok, cid, 'POST', `/orders/${o.id}/change-requests`, {
      lines,
      note: 'Extra for a party',
    }).catch((e) => console.log('change request skipped:', String(e).slice(0, 100)));
  }
}

// Shifts, punches, team, tasks, ingredient.
const members = (await A('GET', '/members')).items;
const emp = members.filter((m) => m.role === 'employee').map((m) => m.user);
const days = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '06:00', endTime: '14:00' }));
await A('PUT', '/shifts', { employeeId: emp[0].id, days });
await A('PUT', '/shifts', {
  employeeId: emp[1].id,
  days: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, startTime: '22:00', endTime: '06:00' })),
});
for (const e of emp)
  await A('PUT', `/employees/${e.id}/products`, {
    productIds: sorted.slice(0, 10).map((p) => p.id),
  });
const mina = await login('mina@sunrise.test');
const flour = ings.find((x) => x.name === 'Bread flour');
if (!flour.responsibleEmployees.length) {
  await A('PUT', `/ingredients/${flour.id}/responsible`, { employeeIds: [emp[0].id] });
  await call(mina, bakery, 'POST', '/ingredient-orders', {
    ingredientId: flour.id,
    quantity: 3,
    note: 'Running low',
  });
}
const card = await call(mina, bakery, 'GET', '/punch/card');
if (card.status === 'off') await call(mina, bakery, 'POST', '/punch', { action: 'start' });
if (!(await A('GET', '/teams')).items.length)
  await A('POST', '/teams', { name: 'Oven team', shared: true, memberIds: emp.map((e) => e.id) });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
if (!(await A('GET', '/tasks?status=open')).items.length) {
  await A('POST', '/tasks', {
    title: 'Clean the proofing cabinet',
    description: 'Wipe shelves and take a photo when done.',
    assigneeId: emp[0].id,
    dueDate: today,
  });
  await A('POST', '/tasks', { title: 'Check flour stock', assigneeId: emp[1].id, dueDate: today });
}
await call(mina, bakery, 'PUT', `/output/${today}`, {
  lines: sorted.slice(0, 4).map((p, j) => ({ productId: p.id, quantity: 20 + j * 5 })),
  cleaningHours: 0.5,
}).catch((e) => console.log(String(e).slice(0, 160)));
const due = await A('GET', '/orders/due-next');
console.log('due-next orders', due.orders.length, 'products', due.totals.length);
// Mark a few made.
for (const t of due.totals.slice(0, 3))
  await A('POST', '/orders/due-next/made', { productId: t.productId, made: true });
console.log('done');
