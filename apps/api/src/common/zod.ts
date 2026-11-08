import { Body, type PipeTransform, Query } from '@nestjs/common';
import { type z } from 'zod';
import { Errors, type FieldErrors } from './errors';

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) {
        const key = [...issue.path, k].join('.');
        (fields[key] ??= []).push('This field is not allowed.');
      }
      continue;
    }
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) throw Errors.validation(toFieldErrors(parsed.error));
    return parsed.data;
  }
}

/** Request body validated by a schema (CLAUDE.md rule 8). */
export const ZodBody = (schema: z.ZodType) => Body(new ZodValidationPipe(schema));
export const ZodQuery = (schema: z.ZodType) => Query(new ZodValidationPipe(schema));
