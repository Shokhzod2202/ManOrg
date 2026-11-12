# Organization Management App

Multi-organization app for a bakery's operations: shifts and punch cards, daily output (personal and team), photo-proof tasks, ingredient ordering, next-day contractor orders and deliveries, and an AI bot manager.

## Source of truth
- `docs/SPEC.md` is the full spec (requirements with IDs, roles and permissions, business rules, data model, API, screens, test plan, roadmap). Read it before any work.
- `docs/F-001.md` is the approved feature change log for delivery-based financial tracking (prices, payments, settlements). It adds to `docs/SPEC.md` and is built after the MVP gate, once delivery management exists. Key rules: money uses actual delivered quantities, only approved payments change the official balance, closed settlement periods are never recalculated, every payment action is audited.
- If code and spec disagree, stop and ask. Do not silently change the spec.
- Open questions are listed in spec section 4 with defaults. Use the defaults and record each one you rely on in `docs/DECISIONS.md`.

## Stack (from spec section 6)
- Monorepo, TypeScript, pnpm: `apps/api` (NestJS, REST, OpenAPI), `apps/web` (Next.js), `apps/mobile` (Expo React Native), `packages/contracts` (openapi.yaml + generated types), `packages/ui`, `packages/config`, `infra/`.
- PostgreSQL 16 with row-level security, Prisma migrations. Redis + BullMQ for jobs. S3-compatible storage for task photos.
- Default timezone Asia/Seoul; store UTC.

## Non-negotiable rules
1. Every business table has `organization_id`. Enforce isolation with RLS and test it. No endpoint may return another organization's rows.
2. Permissions are checked on the server from the matrix in spec section 2. The client never decides access.
3. Time comes from the server only. Never trust client timestamps for punches.
4. Every manual edit (punch, order, delivery, role) writes an `audit_log` row with old value, new value, actor and time.
5. Task photos are camera capture only; the API rejects gallery uploads.
6. Location never punches automatically. Phase 2 only.
7. The AI bot is phase 2. It uses the same API and permission checks; no delete tools.
8. "Next order" means the order due for delivery next, never the order dated tomorrow. Today's Orders and My Orders select by delivery due and must not change at midnight, so night shifts see one stable list (spec TOD-1 to TOD-7).
9. Validate every request body with a schema. No business logic in route handlers; use service modules.

## Workflow
- Work one requirement ID at a time (e.g. SHF-3). Branch `feature/<id>-short-name`; Conventional Commits.
- Definition of done: acceptance criteria covered by tests, permission checks and audit entries present, empty/loading/error states built, OpenAPI updated, lint and type check clean.
- Commands: `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm db:migrate`, `pnpm db:seed`.

## Phase plan
- Phase 0 (weeks 1-2): repo, CI, database, auth, organizations and memberships.
- Phase 1 MVP (weeks 3-12): accounts and approvals, shifts, punch cards, dashboards, output and teams, tasks, products, ingredients, orders, deliveries.
- Phase 2: location notification, AI bot. Phase 3: recurring tasks, prices on orders, more languages.
