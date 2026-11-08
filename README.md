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
pnpm db:seed                      # development only: Sunrise Bakery + City Cafe, password Password123!
pnpm dev                          # API :3001, web :3000, Expo dev server
pnpm test                         # unit, integration and tenant-isolation suites
```

Seed accounts: `admin@sunrise.test` (bakery admin), `mina@sunrise.test` and `joon@sunrise.test`
(employees), `admin@citycafe.test` (contractor admin).

Try the API:

```bash
curl -s localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@sunrise.test","password":"Password123!"}'
# then send Authorization: Bearer <accessToken> and X-Organization-Id: <organization id from GET /me>
```

Tests use a separate database, `manorg_test`, created and migrated automatically.

## Other commands

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm contracts:gen   # regenerate types after editing packages/contracts/openapi.yaml
pnpm build
```

## Production on Windows

The public Mini App is the Docker stack in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). It listens
on `127.0.0.1:4317` only. PostgreSQL and Redis stay on the compose network and are not published
on the host.

## Status

Phase 0 (spec section 14) is done: monorepo, CI, database with row-level security, auth,
organizations, applications, members and roles, and the audit log. The web app signs in with
Telegram or email. Phase 1 features have not started. See `docs/DECISIONS.md` for every default
and choice the code relies on.
