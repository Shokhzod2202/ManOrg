/**
 * Points the bot menu and webhook at this app. Refuses to run unless --confirm-cutover
 * is passed, because this replaces the webhook currently used by the old app.
 * Does not print the bot token or the webhook secret.
 *
 *   node infra/production/scripts/telegram-sync.mjs --dry-run
 *   node infra/production/scripts/telegram-sync.mjs --confirm-cutover
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');
const confirm = process.argv.includes('--confirm-cutover');
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
const webAppUrl = env.TELEGRAM_WEBAPP_URL;
const port = env.EDGE_PORT || '4317';
if (!token || !secret || !webAppUrl) {
  console.error(
    'infra/production/.env is missing TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, or TELEGRAM_WEBAPP_URL.',
  );
  process.exit(1);
}

const origin = new URL(webAppUrl).origin;
const webhookUrl = `${origin}/api/telegram/webhook`;
console.log(`Menu URL: ${webAppUrl}`);
console.log(`Webhook URL: ${webhookUrl}`);
console.log('Allowed updates: message');
console.log(`Local readiness: http://127.0.0.1:${port}/api/v1/health/ready`);

if (dryRun) {
  console.log('Dry run only. The live bot was not changed.');
  process.exit(0);
}
if (!confirm) {
  console.error(
    'Refusing to change the live bot. Re-run with --confirm-cutover after the new app is serving the public URL.',
  );
  process.exit(1);
}

const ready = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`);
if (!ready.ok) {
  console.error('Refusing to update Telegram because the local app is not ready.');
  process.exit(1);
}

async function call(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!payload.ok) {
    console.error(`${method} failed: ${payload.description || response.status}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${method} ok`);
}

await call('setWebhook', {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: false,
});
await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Open app', web_app: { url: webAppUrl } },
});
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Open Shohona Bakery' },
    { command: 'help', description: 'How to open the app' },
  ],
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Telegram menu and webhook now point at this app.');
