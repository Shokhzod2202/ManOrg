import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';
import { Errors } from './errors';

/** Parses `If-Match: "3"` (or `3`) into a row version; required on edits (spec section 8). */
export const IfMatchVersion = createParamDecorator((_: unknown, ctx: ExecutionContext): number => {
  const raw = ctx.switchToHttp().getRequest<Request>().header('if-match');
  if (!raw) throw Errors.preconditionRequired();
  const value = Number(
    raw
      .trim()
      .replace(/^W\//, '')
      .replace(/^"(.*)"$/, '$1'),
  );
  if (!Number.isInteger(value) || value < 1) {
    throw Errors.badRequest('INVALID_IF_MATCH', 'If-Match must be a row version number.');
  }
  return value;
});
