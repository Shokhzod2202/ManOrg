/**
 * Decides whether synthetic Telegram sign-in is allowed.
 * The live bot token and the public bakery are never an allowed target.
 */

const LIVE_HOSTS = new Set(['bakery.haydar.store', '127.0.0.1', 'localhost', '::1']);

export function syntheticBlockReason({ liveBotToken, testBotToken, baseUrl, liveEdgePort }) {
  if (!testBotToken) {
    return 'SMOKE_TEST_BOT_TOKEN is required. The live bot token is not used for sign-in.';
  }
  if (liveBotToken && testBotToken === liveBotToken) {
    return 'Refusing synthetic sign-in because SMOKE_TEST_BOT_TOKEN matches the live bot token.';
  }
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'BASE_URL is not a URL.';
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'bakery.haydar.store' || host.endsWith('.haydar.store')) {
    return 'Refusing synthetic sign-in against the public bakery.';
  }
  if (
    LIVE_HOSTS.has(host) &&
    String(url.port || (url.protocol === 'https:' ? '443' : '80')) === String(liveEdgePort)
  ) {
    return 'Refusing synthetic sign-in against the live edge port.';
  }
  return null;
}

export function forbiddenSyntheticId(id, liveAdminIds) {
  const live = new Set(
    liveAdminIds.map((value) => Number(value)).filter((value) => Number.isSafeInteger(value)),
  );
  live.add(5220814834);
  live.add(4242424242);
  if (live.has(id)) return `Refusing to sign Telegram id ${id}.`;
  return null;
}
