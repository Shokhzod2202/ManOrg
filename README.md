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

## Commands

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm contracts:gen   # regenerate types after editing packages/contracts/openapi.yaml
```
