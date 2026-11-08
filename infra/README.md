# Infra

`docker-compose.yml` runs PostgreSQL 16 and Redis 7 for local development.

```bash
pnpm infra:up      # from the repo root
pnpm infra:down
```

The database has two roles:

| Role           | Used by                             | Notes                                                                                                                                                                                         |
| -------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manorg_owner` | Prisma migrations, seed             | Owns every table.                                                                                                                                                                             |
| `manorg_app`   | The API at runtime (`DATABASE_URL`) | Not an owner and no `BYPASSRLS`, so row-level security filters every query. Created with `manorg_owner` by `postgres/init/01-roles.sh` on first start; table grants come from the migrations. |

To run without Docker, create the same two roles on a local PostgreSQL 16 (see
`postgres/init/01-roles.sh`) and point the URLs in `.env` at it.
