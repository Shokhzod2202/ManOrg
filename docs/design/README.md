# Design

Mockups for the main Phase 1 screens, made on 2026-11-13. The live canvas (pan, zoom, comment,
click through) is https://claude.ai/artifact/RgmJzjiuM8jrZb6Uy2PbyJ; `mockups/` holds its source
files so every version is recorded in git.

| Screen                           | File                    | Requirements                          |
| -------------------------------- | ----------------------- | ------------------------------------- |
| Admin: Today's Dashboard         | `Main.dc.html`          | DSH-1                                 |
| Admin: Delivery management       | `Deliveries.dc.html`    | DEL-1 to DEL-5, DTM-4                 |
| Admin: Shift calendar, week      | `ShiftCalendar.dc.html` | SHF-2, SHF-6, SHF-8                   |
| Employee: Home and punch card    | `EmployeeHome.dc.html`  | DSH-2, SHF-3                          |
| Employee: Today's Orders         | `TodaysOrders.dc.html`  | TOD-1 to TOD-5, ORD-3 change requests |
| Employee: Task with camera photo | `TaskPhoto.dc.html`     | TSK-2                                 |
| Contractor: New order            | `NewOrder.dc.html`      | ORD-2 with the 10:00 rule             |

## Visual rules

- Colours from `packages/ui` tokens: primary blue `#2F5D8A`, ink `#1C1C1A`, ground `#FAFAF7`;
  one colour per employee on calendars; red only for differences and errors, always with an icon
  and text.
- Type: Inter for text, Space Grotesk for headings.
- Touch targets at least 44 px; the punch buttons are the largest controls on the employee home.
- Admin and contractor screens are web pages that also work on a phone; employee screens are
  phone-first.
