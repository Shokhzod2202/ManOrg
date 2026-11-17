// Spec section 13 performance targets, run against a running API (default http://localhost:3002):
//   1. 50 employees punching within one minute;
//   2. the shift dashboard for 100 employees for a month loads in under 2 seconds.
// Run the API for this with a high sign-in limit, e.g. AUTH_RATE_LIMIT_PER_MINUTE=100000 PORT=3002.
// It creates its own organization with 100 employees through the public API.
const B = `${process.env.PERF_API_URL ?? 'http://localhost:3002'}/api/v1`;
const PW = 'Password123!';
const run = Date.now().toString(36);

async function req(method, path, { token, org, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (org) h['X-Organization-Id'] = org;
  if (body) h['Content-Type'] = 'application/json';
  const t0 = performance.now();
  const r = await fetch(B + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = performance.now() - t0;
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${text.slice(0, 200)}`);
  return { ms, data: text ? JSON.parse(text) : null };
}
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size)
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}
const pct = (xs, p) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

console.log('Setting up an organization with 100 employees…');
const admin = (
  await req('POST', '/auth/register', {
    body: { name: 'Perf Admin', email: `perf.admin.${run}@test.local`, password: PW },
  })
).data;
const org = (
  await req('POST', '/organizations', {
    token: admin.tokens.accessToken,
    body: { name: `Perf Bakery ${run}`, type: 'provider' },
  })
).data.organization.id;
const A = admin.tokens.accessToken;
const employees = await inBatches([...Array(100).keys()], 20, async (i) => {
  const e = (
    await req('POST', '/auth/register', {
      body: { name: `Worker ${i}`, email: `perf.${run}.${i}@test.local`, password: PW },
    })
  ).data;
  await req('POST', `/organizations/${org}/applications`, { token: e.tokens.accessToken });
  return { id: e.user.id, token: e.tokens.accessToken };
});
const apps = [];
for (let cursor = null, first = true; first || cursor; first = false) {
  const page = (
    await req('GET', `/applications${cursor ? `?cursor=${cursor}` : ''}`, { token: A, org })
  ).data;
  apps.push(...page.items);
  cursor = page.nextCursor;
}
await inBatches(apps, 20, (a) => req('POST', `/applications/${a.id}/approve`, { token: A, org }));
await inBatches(employees, 20, (e) =>
  req('PUT', '/shifts', {
    token: A,
    org,
    body: {
      employeeId: e.id,
      days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '06:00', endTime: '14:00' })),
    },
  }),
);

// A full past month of punches for every employee (weekdays, 06:00 to 14:00 Seoul).
const now = new Date();
const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const from = month.toISOString().slice(0, 10);
const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
  .toISOString()
  .slice(0, 10);
const days = [];
for (
  let d = new Date(month);
  d.toISOString().slice(0, 10) <= last;
  d.setUTCDate(d.getUTCDate() + 1)
) {
  if (d.getUTCDay() % 6 !== 0) days.push(d.toISOString().slice(0, 10));
}
console.log(`Adding ${employees.length * days.length * 2} punches for ${from} to ${last}…`);
const events = employees.flatMap((e) =>
  days.flatMap((day) => [
    {
      employeeId: e.id,
      eventType: 'start',
      occurredAt: `${day}T06:0${Math.floor(Math.random() * 9)}:00+09:00`,
    },
    { employeeId: e.id, eventType: 'end', occurredAt: `${day}T14:00:00+09:00` },
  ]),
);
// Starts before ends, so each day's events arrive in order.
await inBatches(
  events.filter((e) => e.eventType === 'start'),
  50,
  (body) => req('POST', '/punch-events', { token: A, org, body }),
);
await inBatches(
  events.filter((e) => e.eventType === 'end'),
  50,
  (body) => req('POST', '/punch-events', { token: A, org, body }),
);

// 1. 50 employees press Start Shift at once.
const fifty = employees.slice(0, 50);
const t0 = performance.now();
const punches = await Promise.all(
  fifty.map((e) =>
    req('POST', '/punch', {
      token: e.token,
      org,
      body: { action: 'start' },
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  ),
);
const wall = performance.now() - t0;
const lat = punches.map((p) => p.ms);
console.log(
  `\n1. 50 punches at once: all succeeded in ${(wall / 1000).toFixed(2)} s (target: within 60 s). p50 ${pct(lat, 50).toFixed(0)} ms, p95 ${pct(lat, 95).toFixed(0)} ms.`,
);

// 2. The month dashboard for 100 employees.
const times = [];
let rows = 0;
for (let i = 0; i < 5; i += 1) {
  const r = await req('GET', `/dashboard/shifts?from=${from}&to=${last}`, { token: A, org });
  times.push(r.ms);
  rows = r.data.employees.length;
}
console.log(
  `2. Month dashboard, ${rows} employees × ${days.length} workdays: median ${pct(times, 50).toFixed(0)} ms, worst ${Math.max(...times).toFixed(0)} ms (target: under 2000 ms).`,
);
const pass = wall < 60_000 && Math.max(...times) < 2000 && rows >= 100;
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
