/**
 * Checks a running production proxy: health, same-origin routes, Telegram auth, and
 * that this compose project does not publish PostgreSQL or Redis.
 * Usage: node infra/production/scripts/smoke.mjs
 * Reads infra/production/.env. Does not print secrets.
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(root, 'infra/production/.env');
const composeFile = resolve(root, 'infra/production/docker-compose.yml');
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const port = env.EDGE_PORT || '4317';
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const adminId = Number((env.TELEGRAM_BOOTSTRAP_ADMIN_IDS || '').split(',')[0]);
const employeeId = 4242424242;
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

async function must(label, run) {
  try {
    await run();
    console.log(`ok ${label}`);
  } catch (error) {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function text(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.text();
  return { response, body };
}

function sign(id) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE',
    user: JSON.stringify({ id, first_name: 'Smoke', username: 'smoke' }),
  };
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((key) => `${key}=${fields[key]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return [...keys, 'hash']
    .map((key) => `${key}=${encodeURIComponent(key === 'hash' ? hash : fields[key])}`)
    .join('&');
}

function assertNotPublished(service, containerPort) {
  let published = '';
  try {
    published = execFileSync(
      'docker',
      ['compose', '--env-file', envFile, '-f', composeFile, 'port', service, containerPort],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    const status = error && typeof error === 'object' && 'status' in error ? error.status : 0;
    if (status === 1 || /no container|not published|no such/i.test(stderr)) return;
    throw error;
  }
  // An exposed container port with no host binding is reported as ":0".
  const hostPort = published.slice(published.lastIndexOf(':') + 1);
  if (hostPort && hostPort !== '0') {
    throw new Error(`${service} publishes ${containerPort} at ${published}`);
  }
}

await must('database and redis are not published', async () => {
  assertNotPublished('db', '5432');
  assertNotPublished('redis', '6379');
});

await must('proxy health', async () => {
  const ready = await text('/api/v1/health/ready');
  if (!ready.response.ok) throw new Error(ready.body);
  const health = await text('/api/v1/health');
  if (!health.body.includes('"ok"')) throw new Error(health.body);
  const edge = await text('/healthz');
  if (!edge.body.includes('ok')) throw new Error(edge.body);
});

await must('web is served on the same origin', async () => {
  const page = await text('/');
  if (!page.response.ok) throw new Error(String(page.response.status));
  if (!page.body.includes('Organization Management')) throw new Error('landing text missing');
  if (!page.body.includes('telegram-web-app.js')) throw new Error('Telegram script missing');
});

await must('demo seed accounts are absent', async () => {
  const login = await text('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@sunrise.test', password: 'Password123!' }),
  });
  if (login.response.status !== 401) throw new Error(`expected 401, got ${login.response.status}`);
});

await must('webhook secret and private /start', async () => {
  const missing = await text('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 1 }),
  });
  if (missing.response.status !== 401)
    throw new Error(`expected 401, got ${missing.response.status}`);
  const start = await text('/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      update_id: 2,
      message: { message_id: 1, chat: { id: 1, type: 'private' }, text: '/start' },
    }),
  });
  if (!start.response.ok) throw new Error(start.body);
  const body = JSON.parse(start.body);
  if (body.ok !== true) throw new Error(start.body);
});

await must('telegram admin provisioning and non-admin rejection of forged data', async () => {
  if (!Number.isSafeInteger(adminId) || adminId <= 0) throw new Error('admin id missing');
  const forged = await text('/api/v1/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=00' }),
  });
  if (forged.response.status !== 401) throw new Error(`forged status ${forged.response.status}`);

  const employee = await text('/api/v1/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: sign(employeeId) }),
  });
  if (!employee.response.ok) throw new Error(employee.body);
  const employeeBody = JSON.parse(employee.body);
  if (employeeBody.provisioning !== 'not_bootstrap_admin') throw new Error(employee.body);
  const employeeMe = await text('/api/v1/me', {
    headers: { authorization: `Bearer ${employeeBody.tokens.accessToken}` },
  });
  const employeeAccount = JSON.parse(employeeMe.body);
  if (employeeAccount.memberships.length !== 0) throw new Error('employee was provisioned');

  const admin = await text('/api/v1/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: sign(adminId) }),
  });
  if (!admin.response.ok) throw new Error(admin.body);
  const adminBody = JSON.parse(admin.body);
  if (
    !['created_organization', 'already_member', 'joined_organization'].includes(
      adminBody.provisioning,
    )
  ) {
    throw new Error(admin.body);
  }
  const me = await text('/api/v1/me', {
    headers: { authorization: `Bearer ${adminBody.tokens.accessToken}` },
  });
  const account = JSON.parse(me.body);
  const bakery = account.memberships.find((item) => item.organization?.name === 'Shohona Bakery');
  if (!bakery || bakery.role !== 'admin') throw new Error(me.body);
});

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('smoke checks passed');
