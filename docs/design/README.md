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

## Brand

Haydar Inc logo: `brand/haydar-logo.png` (also served by the web app as `/logo.png`). The
mockup files load it from the canvas's own upload (`/_blob/...`), so they show it only on the
canvas.

## Visual rules

- Colours from `packages/ui` tokens: logo blue `#0B3A8C` (darker `#082C6B`, soft `#EAF0FA`),
  ink `#0F1A33`, clean white ground `#FFFFFF`, borders `#E4E8F0`;
  one colour per employee on calendars; red only for differences and errors, always with an icon
  and text.
- Type: Montserrat for headings (close to the logo lettering), Inter for text.
- Touch targets at least 44 px; the punch buttons are the largest controls on the employee home.
- Admin and contractor screens are web pages that turn into the phone app layout below 760 px
  (bottom tab bar, compact top bar, tables as labelled cards); employee screens are phone-first.
