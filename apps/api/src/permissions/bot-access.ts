import { type z } from 'zod';
import { defineSwitches } from './switches';

/**
 * Powers the admin can give the AI bot beyond its defaults (decided 2026-11-13). All start off,
 * as spec section 10 says. Every bot write is still previewed, confirmed by the admin and audited.
 */
export const botAccessSwitches = defineSwitches({
  decideApplications: { default: false, label: 'Approve or reject applications' },
  manageMembers: { default: false, label: 'Add admins and change roles' },
  manageEmployeeAccess: { default: false, label: 'Change what employees can see' },
});

export const BOT_ACCESS_KEYS = botAccessSwitches.keys;
export type BotAccessKey = (typeof BOT_ACCESS_KEYS)[number];
export type BotAccess = Record<BotAccessKey, boolean>;
export const resolveBotAccess = botAccessSwitches.resolve;
export const updateBotAccessSchema = botAccessSwitches.updateSchema;
export type UpdateBotAccessInput = z.infer<typeof updateBotAccessSchema>;
