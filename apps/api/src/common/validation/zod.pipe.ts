import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from '../errors/app-exception.js';

/**
 * Validate a body/query/param with a shared zod schema.
 * Usage: `create(@Body(new ZodPipe(LeadCreateSchema)) body: LeadCreate)`
 * Returns the parsed OUTPUT (defaults applied, transforms run).
 */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', {
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
