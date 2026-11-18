import { translate } from '../common/i18n';

/** Escapes text for Telegram's HTML parse mode. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

type Payload = Record<string, unknown>;

const won = (v: unknown) => Number(v ?? 0).toLocaleString('en-US');

/** A message: English template with {name} holes, and the values that fill them. */
type Msg = [template: string, vars?: Payload];

/** One line per notification type; unknown types still say something useful. */
export const LINES: Record<string, (p: Payload) => Msg> = {
  'task.assigned': (p) =>
    p.dueDate
      ? ['New task: <b>{title}</b>\nDue {due}', { title: p.title, due: p.dueDate }]
      : ['New task: <b>{title}</b>', { title: p.title }],
  'task.completed': (p) => ['Task done with a photo: <b>{title}</b>', { title: p.title }],
  'application.created': (p) =>
    p.kind === 'contractor'
      ? ['A contractor applied to order from you.']
      : ['Someone applied to join as an employee.'],
  'application.approved': () => ['Your application was approved. You can sign in and start.'],
  'application.rejected': () => ['Your application was not approved.'],
  'ingredient.ordered': (p) => [
    'Ingredient order: <b>{name}</b> × {quantity} packs',
    { name: p.ingredient, quantity: p.quantity },
  ],
  'ingredient.fulfilled': () => ['An ingredient order was bought. Check it when it arrives.'],
  'ingredient.due': (p) => ['Order today: <b>{name}</b>', { name: p.name }],
  'order.placed': () => ['A contractor placed an order.'],
  'order.edited': () => ['Your order was changed by the bakery.'],
  'punch.flagged': (p) => [
    '<b>{name}</b>, {date}: {message}',
    { name: p.name, date: p.date, message: p.message },
  ],
  'punch.change_decided': (p) =>
    p.decision === 'approve'
      ? ['Your shift correction for <b>{date}</b> was approved.', { date: p.shiftDate }]
      : ['Your shift correction for <b>{date}</b> was not approved.', { date: p.shiftDate }],
  'order.change_accepted': (p) => [
    'Change accepted: <b>{product}</b> now {quantity}',
    { product: p.product, quantity: p.quantity },
  ],
  'order.change_rejected': (p) => ['Change not accepted: <b>{product}</b>', { product: p.product }],
  'payment.submitted': (p) => [
    'A contractor confirmed a payment of <b>{amount} won</b>. Review it in Finance.',
    { amount: won(p.amount) },
  ],
  'payment.approved': (p) => [
    'Your payment of <b>{amount} won</b> was approved.',
    { amount: won(p.amount) },
  ],
  'payment.rejected': (p) => [
    'Your payment of <b>{amount} won</b> was not approved: {reason}',
    { amount: won(p.amount), reason: p.reason },
  ],
  'payment.reversed': (p) => [
    'A payment of <b>{amount} won</b> was reversed: {reason}',
    { amount: won(p.amount), reason: p.reason },
  ],
  'settlement.closed': (p) => [
    'Settlement {start} to {end} is closed. Balance: <b>{amount} won</b>',
    { start: p.startDate, end: p.endDate, amount: won(p.closingBalance) },
  ],
  'delivery.completed': (p) => [
    'Delivery for <b>{date}</b> is done. Please confirm it.',
    { date: p.deliveryDate },
  ],
  'delivery.change_requested': () => ['A contractor asked to change a delivery.'],
  'delivery.change_approved': () => ['Your delivery change was approved.'],
  'delivery.change_rejected': () => ['Your delivery change was not approved.'],
  'delivery.approx_time_changed': (p) => [
    'New delivery time: about <b>{start}–{end}</b>',
    { start: p.start, end: p.end },
  ],
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

/** The notification as one line in the person's language (phase 3), with HTML for Telegram. */
export function notificationText(
  type: string,
  payload: Payload,
  organizationName?: string | null,
  locale?: string | null,
) {
  const [template, vars = {}] = LINES[type]?.(payload) ?? [esc(type.replace(/[._]/g, ' '))];
  const escaped = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, esc(v)]));
  const line = translate(template, locale, escaped);
  return organizationName ? `<b>${esc(organizationName)}</b>\n${line}` : line;
}

/** A link button only for https sites; Telegram refuses buttons to localhost. */
export function notificationUrl(type: string, webAppUrl: string): string | undefined {
  if (!webAppUrl.startsWith('https://')) return undefined;
  const page = PAGES[type.split('.')[0] ?? ''] ?? '/app';
  return `${webAppUrl.replace(/\/$/, '')}${page}`;
}
