import assert from 'node:assert/strict';
import { HttpError } from '../src/errors';

/** Asserts that `promise` rejects with an HttpError carrying this status and code. */
export async function expectHttpError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${String(err)}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}
