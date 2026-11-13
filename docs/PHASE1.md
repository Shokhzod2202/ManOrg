# Phase 1 status

Phase 1 MVP (spec section 14) by requirement ID: where it is built and tested. Every endpoint is
in `packages/contracts/openapi.yaml`, permission-checked on the server, audited on every write,
and covered by the tenant-isolation suite. Decisions that change the spec are in
`docs/DECISIONS.md`.

**API: done.** **Web and mobile screens: not started** (see "Not done yet").

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

## Not done yet

| Item                                                                | Why it is open                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app screens (admin, contractor) and Expo app screens (employee) | API first; screens are the next block of work. Today's apps are shells.                                                                           |
| Telegram bot notifications and Mini App                             | Decided 2026-11-13 (alongside the phone app); needs a bot token from BotFather. In-app notifications already store everything Telegram will send. |
| Phone push (FCM, APNs)                                              | Needs Firebase and Apple developer accounts.                                                                                                      |
| Redis and BullMQ jobs                                               | Ingredient reminders run on an in-process timer (`JOBS_ENABLED=true`); move to BullMQ before running more than one API instance.                  |
| Virus scanning of uploads                                           | Decided: before launch.                                                                                                                           |
| Updating the Claude Docs spec with the decisions                    | Waiting for the docs service; all decisions are in `docs/DECISIONS.md`.                                                                           |
