/** Escapes text for Telegram's HTML parse mode. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

type Payload = Record<string, unknown>;

const won = (v: unknown) => `${Number(v ?? 0).toLocaleString('en-US')} won`;

/** One line per notification type; unknown types still say something useful. */
const LINES: Record<string, (p: Payload) => string> = {
  'task.assigned': (p) =>
    `New task: <b>${esc(p.title)}</b>${p.dueDate ? `\nDue ${esc(p.dueDate)}` : ''}`,
  'task.completed': (p) => `Task done with a photo: <b>${esc(p.title)}</b>`,
  'application.created': (p) =>
    p.kind === 'contractor'
      ? 'A contractor applied to order from you.'
      : 'Someone applied to join as an employee.',
  'application.approved': () => 'Your application was approved. You can sign in and start.',
  'application.rejected': () => 'Your application was not approved.',
  'ingredient.ordered': (p) =>
    `Ingredient order: <b>${esc(p.ingredient)}</b> × ${esc(p.quantity)} packs`,
  'ingredient.fulfilled': () => 'An ingredient order was bought. Check it when it arrives.',
  'ingredient.due': (p) => `Order today: <b>${esc(p.name)}</b>`,
  'order.placed': () => 'A contractor placed an order.',
  'order.edited': () => 'Your order was changed by the bakery.',
  'punch.flagged': (p) => `<b>${esc(p.name)}</b>, ${esc(p.date)}: ${esc(p.message)}`,
  'punch.change_decided': (p) =>
    `Your shift correction for <b>${esc(p.shiftDate)}</b> was ${p.decision === 'approve' ? 'approved' : 'not approved'}.`,
  'order.change_accepted': (p) =>
    `Change accepted: <b>${esc(p.product)}</b> now ${esc(p.quantity)}`,
  'order.change_rejected': (p) => `Change not accepted: <b>${esc(p.product)}</b>`,
  'payment.submitted': (p) =>
    `A contractor confirmed a payment of <b>${won(p.amount)}</b>. Review it in Finance.`,
  'payment.approved': (p) => `Your payment of <b>${won(p.amount)}</b> was approved.`,
  'payment.rejected': (p) =>
    `Your payment of <b>${won(p.amount)}</b> was not approved: ${esc(p.reason)}`,
  'payment.reversed': (p) => `A payment of <b>${won(p.amount)}</b> was reversed: ${esc(p.reason)}`,
  'settlement.closed': (p) =>
    `Settlement ${esc(p.startDate)} to ${esc(p.endDate)} is closed. Balance: <b>${won(p.closingBalance)}</b>`,
  'delivery.completed': (p) =>
    `Delivery for <b>${esc(p.deliveryDate)}</b> is done. Please confirm it.`,
  'delivery.change_requested': () => 'A contractor asked to change a delivery.',
  'delivery.change_approved': () => 'Your delivery change was approved.',
  'delivery.change_rejected': () => 'Your delivery change was not approved.',
  'delivery.approx_time_changed': (p) =>
    `New delivery time: about <b>${esc(p.start)}–${esc(p.end)}</b>`,
};

/** Where the button in the message opens, relative to the web app. */
const PAGES: Record<string, string> = {
  task: '/app/tasks',
  punch: '/app/shifts',
  application: '/app/people',
  ingredient: '/app/tasks',
  order: '/app/orders',
  delivery: '/app/deliveries',
  payment: '/app/finance',
  settlement: '/app/finance',
};

export function notificationText(type: string, payload: Payload, organizationName?: string | null) {
  const line = LINES[type]?.(payload) ?? esc(type.replace(/[._]/g, ' '));
  return organizationName ? `<b>${esc(organizationName)}</b>\n${line}` : line;
}

/** A link button only for https sites; Telegram refuses buttons to localhost. */
export function notificationUrl(type: string, webAppUrl: string): string | undefined {
  if (!webAppUrl.startsWith('https://')) return undefined;
  const page = PAGES[type.split('.')[0] ?? ''] ?? '/app';
  return `${webAppUrl.replace(/\/$/, '')}${page}`;
}
