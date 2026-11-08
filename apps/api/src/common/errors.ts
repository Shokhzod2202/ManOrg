import { HttpException, HttpStatus } from '@nestjs/common';

export type FieldErrors = Record<string, string[]>;

/** Error body (spec section 8): { "error": { "code", "message", "fields" } }. */
export interface ErrorBody {
  error: { code: string; message: string; fields?: FieldErrors };
}

export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super({ error: { code, message, ...(fields ? { fields } : {}) } } satisfies ErrorBody, status);
  }
}

export const Errors = {
  validation: (fields: FieldErrors) =>
    new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'The request is not valid.', fields),
  badRequest: (code: string, message: string) =>
    new AppError(HttpStatus.BAD_REQUEST, code, message),
  unauthenticated: (message = 'Sign in to continue.') =>
    new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to do this.') =>
    new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message),
  notFound: (what = 'Resource') =>
    new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`),
  conflict: (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message),
  versionConflict: () =>
    new AppError(
      HttpStatus.CONFLICT,
      'VERSION_CONFLICT',
      'Someone else changed this record. Reload it and try again.',
    ),
  preconditionRequired: () =>
    new AppError(
      HttpStatus.PRECONDITION_REQUIRED,
      'PRECONDITION_REQUIRED',
      'Send the If-Match header with the version you are editing.',
    ),
  unprocessable: (code: string, message: string) =>
    new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message),
} as const;
