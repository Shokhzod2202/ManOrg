/**
 * Live checks for a running proxy. They do not sign in and do not create accounts.
 *
 *   node infra/production/scripts/smoke.mjs
 *
 * Synthetic Telegram identities run only with --synthetic, SMOKE_TEST_BOT_TOKEN set to a
 * token that is not the live bot token, and BASE_URL pointed at an isolated server.
 * That mode refuses the public bakery, the live edge port, Telegram id 5220814834, and
 * Telegram id 4242424242.
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbiddenSyntheticId, syntheticBlockReason } from './smoke-policy.mjs';

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
const synthetic = process.argv.includes('--synthetic');
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
  const hostPort = published.slice(published.lastIndexOf(':') + 1);
  if (hostPort && hostPort !== '0') {
    throw new Error(`${service} publishes ${containerPort} at ${published}`);
  }
}

if (synthetic) {
  const reason = syntheticBlockReason({
    liveBotToken: env.TELEGRAM_BOT_TOKEN || '',
    testBotToken: process.env.SMOKE_TEST_BOT_TOKEN || '',
    baseUrl: base,
    liveEdgePort: port,
  });
  if (reason) {
    console.error(`FAIL ${reason}`);
    process.exit(1);
  }
}

await must('database and redis are not published', async () => {
  assertNotPublished('db', '5432');
  assertNotPublished('redis', '6379');
});

await must('proxy health', async () => {
  const ready = await text('/api/v1/health/ready');
  if (!ready.response.ok) throw new Error(`ready returned ${ready.response.status}`);
  const health = await text('/api/v1/health');
  if (!health.body.includes('"ok"')) throw new Error(`health returned ${health.response.status}`);
  const edge = await text('/healthz');
  if (!edge.body.includes('ok')) throw new Error(`edge returned ${edge.response.status}`);
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

await must('webhook and forged Telegram sign-in are rejected', async () => {
  const missing = await text('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 1 }),
  });
  if (missing.response.status !== 401) throw new Error(`webhook status ${missing.response.status}`);
  const wrong = await text('/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'wrong-secret',
    },
    body: JSON.stringify({ update_id: 2 }),
  });
  if (wrong.response.status !== 401) throw new Error(`webhook status ${wrong.response.status}`);
  const forged = await text('/api/v1/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=00' }),
  });
  if (forged.response.status !== 401) throw new Error(`forged status ${forged.response.status}`);
});

if (synthetic) {
  const testToken = process.env.SMOKE_TEST_BOT_TOKEN;
  const liveAdmins = (env.TELEGRAM_BOOTSTRAP_ADMIN_IDS || '').split(',');
  for (const id of [9100000001, 9100000002]) {
    const blocked = forbiddenSyntheticId(id, liveAdmins);
    if (blocked) {
      console.error(`FAIL ${blocked}`);
      process.exit(1);
    }
  }
  await must('isolated synthetic identities are not live ids', async () => {
    const employee = await syntheticLogin(testToken, 9100000001);
    if (employee.provisioning !== 'not_bootstrap_admin') {
      throw new Error(`unexpected provisioning ${employee.provisioning}`);
    }
    const admin = await syntheticLogin(testToken, 9100000002);
    if (
      !['created_organization', 'already_member', 'joined_organization', 'promoted_admin'].includes(
        admin.provisioning,
      )
    ) {
      throw new Error(`unexpected provisioning ${admin.provisioning}`);
    }
  });
}

function sign(token, id) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE',
    user: JSON.stringify({ id, first_name: 'Smoke', username: 'smoke' }),
  };
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((key) => `${key}=${fields[key]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return [...keys, 'hash']
    .map((key) => `${key}=${encodeURIComponent(key === 'hash' ? hash : fields[key])}`)
    .join('&');
}

async function syntheticLogin(token, id) {
  const blocked = forbiddenSyntheticId(id, (env.TELEGRAM_BOOTSTRAP_ADMIN_IDS || '').split(','));
  if (blocked) throw new Error(blocked);
  const response = await text('/api/v1/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: sign(token, id) }),
  });
  if (!response.response.ok) throw new Error(`sign-in status ${response.response.status}`);
  const body = JSON.parse(response.body);
  return { provisioning: body.provisioning };
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('smoke checks passed');
