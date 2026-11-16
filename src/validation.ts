import { z } from 'zod';
import { badRequest } from './errors';

/**
 * Validates untrusted input (body, params, query) against a schema and returns
 * fully typed data, or throws a 400 listing every problem.
 */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));
    throw badRequest('VALIDATION_ERROR', 'Request validation failed', details);
  }
  return result.data;
}

/** UUIDs are lower-cased so "ABC…" and "abc…" can never become two different users or chats. */
export const uuid = z
  .string()
  .uuid('must be a valid UUID')
  .transform((value) => value.toLowerCase());

/** Firestore auto-generated document id. Also blocks "/" so ids can't escape their collection path. */
export const messageId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'must be a valid message id');

export const messageText = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(4000, 'must be at most 4000 characters');

export const displayName = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(100, 'must be at most 100 characters');
