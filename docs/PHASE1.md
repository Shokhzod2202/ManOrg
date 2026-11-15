# Phase 1 status

Phase 1 MVP (spec section 14) by requirement ID: where it is built and tested. Every endpoint is
in `packages/contracts/openapi.yaml`, permission-checked on the server, audited on every write,
and covered by the tenant-isolation suite. Decisions that change the spec are in
`docs/DECISIONS.md`.

**API: done. Web app: done.** One responsive Next.js app (`apps/web`) serves admins, employees
and contractors; on a phone (under 760 px) it looks like the phone app, with a bottom tab bar and
cards. The native Expo app is a Phase 2 wrapper (see "Not done yet").

| Area                               | IDs                              | Endpoints                                                                                                                                                             | Tests                                                    |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Accounts, organizations, approvals | ACC-1 to ACC-8                   | `/auth/*`, `/me`, `/organizations`, `/applications`, `/members`                                                                                                       | `auth`, `me`, `organizations`, `applications`, `members` |
| Permission settings                | decisions 2026-11-12/13          | `/organization/employee-access`, `/organization/bot-access`                                                                                                           | `settings`, `permissions` (unit)                         |
| Shifts and punch cards             | SHF-1 to SHF-8                   | `/shifts`, `/punch`, `/punch/card`, `/punch-events`, `/punch-change-requests`, `/dashboard/shifts`, `/dashboard/me`                                                   | `shifts`, `timesheet` (unit)                             |
| Output and teams                   | OUT-1 to OUT-7, TEAM-1 to TEAM-5 | `/teams`, `/output/{date}`, `/output`, `/dashboard/shift-output`                                                                                                      | `output`, `calc` (unit)                                  |
| Tasks                              | TSK-1 to TSK-3                   | `/tasks`, `/tasks/{id}/capture-token`, `/tasks/{id}/complete`                                                                                                         | `tasks`, `exif` (unit)                                   |
| Products                           | PRD-1 to PRD-3                   | `/product-images`, `/products`, `/employees/{id}/products`, `/files/{key}`                                                                                            | `products`, `storage-keys` (unit)                        |
| Ingredients                        | ING-1 to ING-8                   | `/ingredients`, `/ingredients/{id}/price`, `/ingredients/{id}/responsible`, `/ingredient-orders`                                                                      | `ingredients`, `tasks`                                   |
| Orders                             | ORD-1 to ORD-4                   | `/providers`, `/catalog`, `/orders`, `/orders/default-date`, `/orders/totals`, `/orders/{id}/change-requests`, `/order-change-requests`, `/order-change-items/{id}/*` | `orders`, `order-dates` (unit)                           |
| Deliveries                         | DEL-1 to DEL-6                   | `/deliveries`, `/deliveries/{contractorId}/{date}`, `/deliveries/{id}/*`                                                                                              | `deliveries`                                             |
| Approximate delivery time          | DTM-1 to DTM-6                   | `/contractors`, `/contractors/{id}/approx-time`                                                                                                                       | `deliveries`                                             |
| Today's Orders, My Orders          | TOD-1 to TOD-7                   | `/orders/due-next`, `/employees/{id}/orders/due-next`                                                                                                                 | `deliveries`                                             |
| Dashboards                         | DSH-1, DSH-2                     | `/dashboard/today`, `/dashboard/home`                                                                                                                                 | `dashboards`                                             |
| Notifications (in-app)             | section 9                        | `/notifications`                                                                                                                                                      | `tasks`, `orders`, `deliveries`, `dashboards`            |

## Web screens

| Screen                         | Route                 | Who                         | IDs                                |
| ------------------------------ | --------------------- | --------------------------- | ---------------------------------- |
| Sign in, create account        | `/login`, `/register` | everyone                    | ACC-1, ACC-2                       |
| Start: create or join          | `/start`              | new accounts                | ACC-3 to ACC-6                     |
| Today (admin dashboard)        | `/app`                | provider admin              | DSH-1, TOD-1                       |
| Home with punch card           | `/app`                | employee                    | DSH-2, SHF-4, TOD-4                |
| Orders: List, Matrix, Products | `/app/orders`         | provider admin, employee    | TOD-1 to TOD-7, ORD-4, made ticks  |
| My orders, change requests     | `/app`, `/app/orders` | contractor                  | ORD-1, ORD-3                       |
| New order                      | `/app/orders/new`     | contractor                  | ORD-2, 10:00 rule                  |
| Deliveries                     | `/app/deliveries`     | provider admin, contractor  | DEL-1 to DEL-6, DTM-1              |
| Shifts calendar, plan, fixes   | `/app/shifts`         | admin; employee (own)       | SHF-1 to SHF-8                     |
| Output                         | `/app/output`         | employee; admin summary     | OUT-1 to OUT-7, DSH-3              |
| Tasks with camera photo        | `/app/tasks`          | admin, employee             | TSK-1 to TSK-3, ING-5, ING-6       |
| Products                       | `/app/products`       | provider admin              | PRD-1 to PRD-3                     |
| Ingredients and prices         | `/app/ingredients`    | admin; employee (order)     | ING-1 to ING-8                     |
| People and teams               | `/app/people`         | admins                      | ACC-3, ACC-6 to ACC-8, TEAM-1 to 5 |
| Settings                       | `/app/settings`       | everyone                    | Employee access, Bot permissions   |
| Notifications                  | `/app/notifications`  | everyone                    | section 9                          |
| Wall screen                    | `/wall`               | provider admin (kitchen TV) | TOD-1                              |

Every screen has loading, error and empty states. Browser checks: `apps/web/e2e/flows.cjs`
(delivery recorded and confirmed, task finished with a camera photo, employee accepts an added
product, contractor places an order) and `apps/web/e2e/screens.cjs` (every page for each role at
1440 px and 390 px: no console errors, no failed API calls, no sideways page scroll). Run them
with the API and web app started and demo data loaded (`pnpm db:demo`).

## Not done yet

| Item                                             | Why it is open                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native phone app (Expo)                          | Phase 2: a thin wrapper around the same screens. The website already works as the phone app on a phone.                                           |
| Sign-in tokens in an httpOnly cookie             | The web app keeps tokens in browser storage for now; move to an httpOnly cookie behind a small server route before launch.                        |
| Telegram bot notifications and Mini App          | Decided 2026-11-13 (alongside the phone app); needs a bot token from BotFather. In-app notifications already store everything Telegram will send. |
| Phone push (FCM, APNs)                           | Needs Firebase and Apple developer accounts.                                                                                                      |
| Redis and BullMQ jobs                            | Ingredient reminders run on an in-process timer (`JOBS_ENABLED=true`); move to BullMQ before running more than one API instance.                  |
| Virus scanning of uploads                        | Decided: before launch.                                                                                                                           |
| Updating the Claude Docs spec with the decisions | Waiting for the docs service; all decisions are in `docs/DECISIONS.md`.                                                                           |
