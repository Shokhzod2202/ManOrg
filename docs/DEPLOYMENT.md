# Deploy ManOrg on Windows

Replace the disposable bakery test app at `https://bakery.haydar.store`. Build and run this on the
Windows Docker Desktop host. Node 22 and pnpm 10.28.0 are in the images. The host copies of those
tools are for development.

Host port `5432` is a separate Postgres process. This stack does not publish `5432` or `6379` and
does not stop that process. The old bakery database is SQLite and is not imported.

The only published port is `127.0.0.1:4317`. The existing Cloudflare tunnel already terminates TLS
for `https://bakery.haydar.store` and should keep forwarding to that address.

Secrets stay in `infra\production\.env` on that PC. Do not commit that file and do not paste it
into chat.

## Recover the stopped first start

The first Windows start built the images and then Postgres exited 126:
`/docker-entrypoint-initdb.d/01-roles.sh: /bin/sh^M: bad interpreter`. `core.autocrlf=true` had
checked the script out as CRLF. The volume `shohona_prod_postgres` has a data directory and no
ManOrg roles. Postgres will not run that init script again. Do not delete the volume. The `db-init`
service applies the same script over the network, and it is safe to run again.

Leave the process on port `5432` running. Do not run `docker volume prune`.

From the repo root. This keeps the existing `.env`:

```powershell
Copy-Item -Force .\infra\production\.env "$env:TEMP\shohona-production.env"
git fetch origin cursor/windows-prod-miniapp-efa2
git checkout cursor/windows-prod-miniapp-efa2
git reset --hard origin/cursor/windows-prod-miniapp-efa2
if (-not (Test-Path .\infra\production\.env)) {
  Copy-Item -Force "$env:TEMP\shohona-production.env" .\infra\production\.env
}
git ls-files --eol -- infra/postgres/init/01-roles.sh infra/postgres/init/check-passwords.sh infra/production/scripts/db-init.sh
```

Each of those lines must show `i/lf` and `w/lf`. Do not run `generate-env.ps1` again.

The old test app is on `4317` again. Stop only that container:

```powershell
docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"
docker stop <old-test-container>
```

The images are already built. Start the same project. This does not remove `shohona_prod_postgres`:

```powershell
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml up -d
curl.exe http://127.0.0.1:4317/api/v1/health/ready
node .\infra\production\scripts\smoke.mjs
```

`/api/v1/health/ready` returns 200 when the roles exist and migrations have been applied. Then:

```powershell
node .\infra\production\scripts\telegram-sync.mjs --dry-run
node .\infra\production\scripts\telegram-sync.mjs --confirm-cutover
```

If `db-init` fails, read its log before touching a volume:

```powershell
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml logs db-init
```

Only when that log shows the cluster has no ManOrg data, and you still want an empty cluster, remove
this one volume and start again:

```powershell
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml down
docker volume rm shohona_prod_postgres
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml up -d
```

`down` without `-v` leaves the volume in place. `docker volume rm` in that command names
`shohona_prod_postgres` only.

## What is included

| URL                                                | What it is                                                    |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `https://bakery.haydar.store/`                     | Web app                                                       |
| `https://bakery.haydar.store/api/v1/...`           | API                                                           |
| `https://bakery.haydar.store/api/telegram/webhook` | Existing bot webhook, forwarded to `/api/v1/telegram/webhook` |

Telegram sign-in sends `Telegram.WebApp.initData` to `POST /api/v1/auth/telegram`. The API checks
the HMAC with the bot token. A bare user id, forged `initData`, or a development login is rejected.

| Person                                                                                 | Result                                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Telegram id in `TELEGRAM_BOOTSTRAP_ADMIN_IDS` (`5220814834`), with no organization yet | Admin of a new bakery named `Shohona Bakery`                      |
| That same id later                                                                     | Membership is left as it is. A removed admin is not granted again |
| That id when the person already has an organization                                    | No second bakery is created                                       |
| Anyone else                                                                            | Ordinary account, no membership, not an admin                     |

The bot stays `@shohona_bakery_bot` (id `9193524838`). `telegram-sync.mjs --confirm-cutover` sets
the menu button to `https://bakery.haydar.store` and `setWebhook` to
`https://bakery.haydar.store/api/telegram/webhook` with header `X-Telegram-Bot-Api-Secret-Token`
and `allowed_updates: ["message"]`. Private `/start` and `/help` reply with an Open App button.
Other private messages get a pointer to the app. Anything that is not a private message is
acknowledged and ignored.

This build is accounts, organizations, memberships, and that sign-in. Shifts, punch cards, output,
tasks, orders, and deliveries are not in it. The database starts empty. The first allow-listed
Telegram sign-in creates the bakery. The demo accounts (`admin@sunrise.test` / `Password123!`) are
not created.

## 1. Stop only the old test app

```powershell
docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"
```

Stop the container whose ports include `4317`. Do not stop anything listening on `5432`.

```powershell
docker stop <old-test-container>
```

`docker stop` is enough to free the port. Delete that container later, after the new app has
signed in through Telegram, and only if you are sure it is the test app. Do not run
`docker volume prune`.

Leave the tunnel config pointed at `http://127.0.0.1:4317` (or `http://localhost:4317`).

## 2. Generate secrets and build

Skip this step when `infra\production\.env` already exists. Generating again replaces the webhook
secret. From the repo root, only for a new machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\production\scripts\generate-env.ps1
```

Open `infra\production\.env` on this PC and set `TELEGRAM_BOT_TOKEN` from BotFather. Confirm:

```text
EDGE_PORT=4317
TELEGRAM_BOOTSTRAP_ADMIN_IDS=5220814834
TELEGRAM_BOOTSTRAP_ORG_NAME=Shohona Bakery
TELEGRAM_BOOTSTRAP_TIMEZONE=Asia/Tashkent
TELEGRAM_WEBAPP_URL=https://bakery.haydar.store
CORS_ORIGIN=https://bakery.haydar.store
```

Leave the generated webhook secret as it is. Do not run `pnpm db:seed`.

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\production\scripts\deploy.ps1
```

That runs:

```powershell
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml up -d --build
```

If the build is killed, build one target at a time and start again:

```powershell
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml build api
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml build web
powershell -ExecutionPolicy Bypass -File .\infra\production\scripts\deploy.ps1
```

Build on this machine. The script does not stop a busy port and does not touch port `5432`.

## 3. Check, then point the bot

```powershell
curl.exe http://127.0.0.1:4317/healthz
curl.exe http://127.0.0.1:4317/api/v1/health
curl.exe http://127.0.0.1:4317/api/v1/health/ready
curl.exe http://127.0.0.1:4317/
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:4317/api/v1/auth/login -H "content-type: application/json" -d "{\"email\":\"admin@sunrise.test\",\"password\":\"Password123!\"}"
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml ps
node .\infra\production\scripts\smoke.mjs
```

`/api/v1/health/ready` means the API reached its own database. Demo login returns `401`.
`docker compose ps` shows `127.0.0.1:4317->8080` on the proxy and no `5432` or `6379`.

Open `https://bakery.haydar.store` from outside the machine. Then:

```powershell
node .\infra\production\scripts\telegram-sync.mjs --dry-run
node .\infra\production\scripts\telegram-sync.mjs --confirm-cutover
```

Dry-run prints the URLs and does not call Telegram. `--confirm-cutover` updates the live bot.
Open `@shohona_bakery_bot` as user `5220814834` and confirm the Mini App signs that user in as
admin of `Shohona Bakery`. A different Telegram user gets an account with no membership.

## If the new process is bad

```powershell
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml stop
docker start <old-test-container>
```

`stop` does not delete `shohona_prod_postgres`. Starting the old container only works if you have
not removed it. There is no SQLite import to undo.

Logs:

```powershell
docker compose --env-file .\infra\production\.env -f .\infra\production\docker-compose.yml logs -f api proxy
```

Migrations run as `manorg_owner`. The API then uses `manorg_app`, so row-level security applies.
Redis is on the private network, has a password, and is unused by this API.

Changing `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` signs everyone out. Changing
`TELEGRAM_WEBHOOK_SECRET` needs another `--confirm-cutover`, or Telegram receives `401`.

## Files

| Path                                         | Role                                                         |
| -------------------------------------------- | ------------------------------------------------------------ |
| `.gitattributes`                             | Checks out shell scripts and configs as LF                   |
| `infra/production/docker-compose.yml`        | Project `shohona_prod`. No host database or Redis ports      |
| `infra/production/Dockerfile`                | API and web images                                           |
| `infra/production/nginx.conf`                | One origin. Legacy webhook path. Telegram may frame the page |
| `infra/production/.env.example`              | Names only                                                   |
| `infra/production/scripts/db-init.sh`        | Creates roles again on a partial volume                      |
| `infra/production/scripts/generate-env.ps1`  | Local secrets                                                |
| `infra/production/scripts/deploy.ps1`        | Build and start on `127.0.0.1:4317`. No NetTCPIP module      |
| `infra/production/scripts/telegram-sync.mjs` | Menu and webhook. Live call needs `--confirm-cutover`        |
| `infra/production/scripts/smoke.mjs`         | Health, auth, proxy, and port checks                         |
| `infra/production/SHA256SUMS`                | Checksums of the packaging files above                       |
