#!/bin/sh
# Writes infra/production/.env with locally generated secrets. Does not print secret values.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
OUT="$ROOT/infra/production/.env"
FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi
if [ -f "$OUT" ] && [ "$FORCE" -ne 1 ]; then
  echo "$OUT already exists. Re-run with --force to replace it." >&2
  exit 1
fi

umask 077
secret() { openssl rand -hex 32; }

BOT=${TELEGRAM_BOT_TOKEN:-}
WEBHOOK=${TELEGRAM_WEBHOOK_SECRET:-$(secret)}
ADMINS=${TELEGRAM_BOOTSTRAP_ADMIN_IDS:-5220814834}

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
cat >"$tmp" <<EOF
# Generated locally by generate-env.sh. Do not commit.
EDGE_PORT=${EDGE_PORT:-4317}
POSTGRES_PASSWORD=$(secret)
MANORG_OWNER_PASSWORD=$(secret)
MANORG_APP_PASSWORD=$(secret)
REDIS_PASSWORD=$(secret)
JWT_ACCESS_SECRET=$(secret)
JWT_REFRESH_SECRET=$(secret)
TELEGRAM_BOT_TOKEN=${BOT}
TELEGRAM_WEBHOOK_SECRET=${WEBHOOK}
TELEGRAM_BOOTSTRAP_ADMIN_IDS=${ADMINS}
TELEGRAM_BOOTSTRAP_ORG_NAME=${TELEGRAM_BOOTSTRAP_ORG_NAME:-Shohona Bakery}
TELEGRAM_BOOTSTRAP_TIMEZONE=${TELEGRAM_BOOTSTRAP_TIMEZONE:-Asia/Tashkent}
TELEGRAM_WEBAPP_URL=${TELEGRAM_WEBAPP_URL:-https://bakery.haydar.store}
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=${TELEGRAM_INIT_DATA_MAX_AGE_SECONDS:-900}
APP_TIMEZONE_DEFAULT=${APP_TIMEZONE_DEFAULT:-Asia/Seoul}
CORS_ORIGIN=${CORS_ORIGIN:-https://bakery.haydar.store}
EOF
mv "$tmp" "$OUT"
chmod 600 "$OUT"
trap - EXIT
echo "Wrote $OUT (mode 600)."
if [ -z "$BOT" ]; then
  echo "TELEGRAM_BOT_TOKEN is empty. Fill it locally from BotFather before starting the stack."
fi
echo "Admin Telegram ids: ${ADMINS}"
echo "Edge port: ${EDGE_PORT:-4317}"
