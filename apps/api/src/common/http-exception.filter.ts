import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { type ErrorBody } from './errors';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/** Turns every error into the spec's error body. Logs carry no names, emails or coordinates. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toBody(exception);
    if (status >= 500) {
      const name = exception instanceof Error ? exception.name : 'UnknownError';
      const code = exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : '';
      this.logger.error(
        `Unhandled ${name} ${code}`.trim(),
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    res.status(status).json(body);
  }

  private toBody(exception: unknown): [number, ErrorBody] {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'error' in response) {
        const error = (response as ErrorBody).error;
        if (typeof error === 'object' && error !== null && 'code' in error)
          return [status, response as ErrorBody];
      }
      const message =
        typeof response === 'string'
          ? response
          : typeof (response as { message?: unknown }).message === 'string'
            ? (response as { message: string }).message
            : exception.message;
      return [status, { error: { code: STATUS_CODES[status] ?? 'ERROR', message } }];
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return [
          HttpStatus.CONFLICT,
          { error: { code: 'ALREADY_EXISTS', message: 'This record already exists.' } },
        ];
      }
      if (exception.code === 'P2025') {
        return [
          HttpStatus.NOT_FOUND,
          { error: { code: 'NOT_FOUND', message: 'Resource not found.' } },
        ];
      }
    }
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { error: { code: 'INTERNAL', message: 'Something went wrong. Try again.' } },
    ];
  }
}
