import { type AuthUser, type OrgContext } from '../common/request-context';

/** The bot acting for one admin: its own matrix column, audited as "bot" (spec section 10). */
export interface BotCtx {
  user: AuthUser;
  org: OrgContext;
}

/** What the admin sees before confirming: one line per change, before and after. */
export interface Preview {
  summary: string;
  rows: number;
  changes: { label: string; before: unknown; after: unknown }[];
}

/** Raised for input the model can fix; goes back to it as a tool error, never to the admin. */
export class ToolInputError extends Error {}
