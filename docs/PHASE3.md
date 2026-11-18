# Phase 3 status

Phase 3 (CLAUDE.md phase plan): recurring tasks, prices on orders (built as the approved F-001
delivery-based financial tracking in `docs/F-001.md`), and more languages (Korean and Uzbek).
Decisions are in `docs/DECISIONS.md`.

**Phase 3: done in code.** Every F-001 requirement ID and every spec section 3 ID has a test
(`pnpm check:requirements`: 87 of 87).

## Prices, payments and settlements (F-001)

| Part                                                                                                                        | Where                                                                                                          | Tests                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Product prices in whole won with history; set on the Products page                                                          | `PUT /products/{id}/price`, `GET /products/{id}/prices`; `products.service.ts`                                 | `test/api/finance.test.ts` (FIN-1 to FIN-5)                   |
| Price copied onto each delivery line when the delivery is completed; values from delivered quantities only                  | `apps/api/src/finance/pricing.ts`, `deliveries.service.ts`                                                     | `test/api/finance.test.ts`                                    |
| Contractor dashboard: deliveries with prices and values, period totals, payments, outstanding, history, own schedule        | Finance page (contractor); `GET /finance/summary`, `/finance/deliveries`, `/finance/history`                   | `test/api/finance-dashboards.test.ts` (CFD-1 to CFD-7)        |
| Admin dashboard: every contractor's balance, filters, history, schedules, review queue                                      | Finance page (admin)                                                                                           | `test/api/finance-dashboards.test.ts` (AFD-1 to AFD-8)        |
| Payment with proof (photo or PDF up to 10 MB), withdraw while pending, approve with allocation, reject with reason, reverse | `POST /payments`, `/payments/{id}/cancel`, `/approve`, `/reject`, `/reverse`, `PUT /payments/{id}/allocations` | `test/api/finance.test.ts` (PAY-1 to PAY-8), e2e step 15      |
| Settlement schedule per contractor, reports, closing; closed periods never recalculated                                     | `GET /settlement-schedules`, `PUT /contractors/{id}/settlement-schedule`, `/settlement-reports/{id}[/close]`   | `test/api/finance.test.ts` (SET-1 to SET-6), e2e step 15      |
| Notifications: payment submitted, approved, rejected, reversed; settlement closed (in-app, push, Telegram)                  | `notifications`, `push.service.ts`, `telegram.text.ts`                                                         | `test/api/finance.test.ts`, `test/api/i18n.test.ts`           |
| Row-level security on every new table; closed reports and price rows are insert-only for the app                            | migration `20261118100000_finance`                                                                             | `test/api/tenant-isolation.test.ts` (catalog and every route) |

All eight test scenarios of F-001 section 8 are in `test/api/finance.test.ts`.

## Repeating tasks

| Part                                                                                                                                   | Where                                                                                               | Tests                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Rules: every day, every week on chosen weekdays, or every month on a day (31 = last day of shorter months), from a start, optional end | `GET/POST /recurring-tasks`, `PATCH /recurring-tasks/{id}` (If-Match); `recurring-tasks.service.ts` | `test/api/recurring-tasks.test.ts`                 |
| Each due day makes one ordinary photo-proof task, in the bakery's time zone; a unique key on (rule, day) keeps it to one               | job `recurring-tasks` every 15 minutes; a rule due today makes today's task at once                 | `test/api/recurring-tasks.test.ts`, `jobs.test.ts` |
| Pause, resume, end after today; every change audited                                                                                   | Tasks page → Repeating tab                                                                          | `test/api/recurring-tasks.test.ts`, e2e step 16    |
| Tasks page: "Repeat" on a new task; a "Repeats" badge on tasks a rule made                                                             | `apps/web/src/app/app/tasks/page.tsx`                                                               | e2e step 16                                        |

## The bot in phase 3

New tools, each a previewed proposal applied only on Confirm through the same service and
permission check: `create_recurring_task`, `change_recurring_task`, `set_product_price`,
`decide_payment` (approve, allocated to the oldest unpaid deliveries first, or reject with a
reason). New reads in `search_data`: `repeating_tasks`, `finance_summary`, `payments`. Tests:
`test/api/bot-more.test.ts`.

## Languages: English, Korean, Uzbek

| Part                                                                                                      | Where                                                                                     | Tests                                      |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `t()` with the English text as key; Korean and Uzbek dictionaries; English when a text has no translation | `apps/web/src/lib/i18n.tsx`, `apps/web/src/lib/i18n/ko.ts`, `uz.ts`                       | `apps/web/src/lib/i18n.test.ts`            |
| Every `t()` text in the screens has Korean and Uzbek, with the same `{placeholders}`                      |                                                                                           | `apps/web/src/lib/i18n.test.ts`            |
| Language picker on the landing, sign-in and register pages, and in Settings; saved on the account         | `PATCH /me` `locale`                                                                      | e2e step 17                                |
| Dates and times in the chosen language                                                                    | `apps/web/src/lib/api.ts`                                                                 |                                            |
| Phone push, Telegram messages and the arrival reminder in each person's language                          | `apps/api/src/common/i18n.ts`, `telegram.text.ts`, `push.service.ts`, `shifts.service.ts` | `test/api/i18n.test.ts`, `arrival.test.ts` |
| The bot answers in the language the admin writes in                                                       | bot instructions                                                                          |                                            |

Names typed by people (products, ingredients, teams, notes) are shown as typed. Error texts from
the server are translated on screen when they are in the dictionaries; others show in English.

## Before launch

- Have a native Korean speaker and a native Uzbek speaker read the screens once
  (`apps/web/src/lib/i18n/ko.ts`, `uz.ts`); wording changes there need no code change.
- Confirm with the bakery the default settlement schedule (1–15 and 16–end of month) and whether
  VAT must ever be shown (F-001 open question F8: plain won, no tax).
- Telegram live check, as planned, at the end.
