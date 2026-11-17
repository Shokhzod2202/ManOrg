# Organization Management App

Multi-organization app for a bakery's daily operations: shifts and punch cards, daily output,
photo-proof tasks, ingredient ordering, next-day contractor orders and deliveries.

- Spec: [`docs/SPEC.md`](docs/SPEC.md) (source of truth)
- Decisions and the spec defaults the code relies on: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Rules for contributors and agents: [`CLAUDE.md`](CLAUDE.md)

## Layout

| Path                 | What                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `apps/api`           | NestJS REST API under `/api/v1`, Prisma, PostgreSQL               |
| `apps/web`           | Next.js web app for admins and contractors                        |
| `apps/mobile`        | Expo (React Native) app for employees                             |
| `packages/contracts` | `openapi.yaml` (the API contract) and the types generated from it |
| `packages/ui`        | Design tokens shared by web and mobile                            |
| `packages/config`    | Shared TypeScript, ESLint and Prettier config                     |
| `infra`              | Docker Compose for PostgreSQL 16 and Redis                        |

## Run it locally

Needs Node 22, pnpm 10 and Docker.

```bash
pnpm install                      # also generates the Prisma client
cp .env.example .env              # then set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET:
                                  #   openssl rand -hex 32
pnpm infra:up                     # PostgreSQL 16 and Redis (infra/docker-compose.yml)
pnpm db:migrate                   # apply migrations
pnpm db:seed                      # Sunrise Bakery + City Cafe, password Password123!
pnpm dev                          # API :3001, web :3000, Expo dev server
pnpm db:demo                      # optional, with the API running: products, contractors, orders
pnpm test                         # unit, integration and tenant-isolation suites
```

Seed accounts: `admin@sunrise.test` (bakery admin), `mina@sunrise.test` and `joon@sunrise.test`
(employees), `admin@citycafe.test` (contractor admin).

Open http://localhost:3000 and sign in. On a phone, or a browser narrower than 760 px, the
website looks like the phone app. The kitchen TV view is http://localhost:3000/wall.

Browser checks (with the API, web app and demo data running): `pnpm --filter @manorg/web e2e`.

Try the API:

```bash
curl -s localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@sunrise.test","password":"Password123!"}'
# then send Authorization: Bearer <accessToken> and X-Organization-Id: <organization id from GET /me>
```

Tests use a separate database, `manorg_test`, created and migrated automatically.

## Telegram notifications

The bot (@haydar_inc_bot) sends each person the same notifications they see in the app. People
connect in **Settings → Telegram → Connect Telegram**, which opens the bot with a one-time code;
`/stop` in the chat or **Disconnect** in Settings ends it.

1. Put the BotFather token in the server's environment as `TELEGRAM_BOT_TOKEN` (never in git).
2. Sending runs with the other jobs: `JOBS_ENABLED=true` on one API instance.
3. Receiving `/start` and `/stop`:
   - Production (public https API): set `TELEGRAM_WEBHOOK_SECRET`, then register the webhook once:
     `curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d url=https://<api-host>/api/v1/telegram/webhook -d secret_token=$TELEGRAM_WEBHOOK_SECRET`
   - Development: `TELEGRAM_POLLING=true` (no public URL needed).
4. Set `WEB_APP_URL` to the https site so messages get an "Open Haydar" button.

## Other commands

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm contracts:gen   # regenerate types after editing packages/contracts/openapi.yaml
pnpm build
pnpm check:requirements           # every requirement ID in the spec has a test
pnpm --filter @manorg/web e2e     # browser checks (API and web running); loads demo data first
# performance targets (spec section 13), against a second API with a high sign-in limit:
#   AUTH_RATE_LIMIT_PER_MINUTE=100000 PORT=3002 pnpm --filter @manorg/api dev &  node scripts/perf.mjs
```

## Status

Phases 0 and 1 are done in code: the API and one responsive web app for admins, employees and
contractors (on a phone it looks like the phone app), with Telegram notifications, scheduled jobs
on Redis, and the checks from spec section 13 (requirement traceability, tenant isolation,
browser flows, performance). What is left before launch needs accounts, hosting or the pilot day;
see `docs/PHASE1.md`. Every default and choice the code relies on is in `docs/DECISIONS.md`.
