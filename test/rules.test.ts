import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { directChatKey } from '../src/chats/chat.rules';
import { HttpError } from '../src/errors';
import { decideReadReceipt, previewOf, shouldAdvanceLastSeen } from '../src/messages/message.rules';
import type { Message } from '../src/messages/message.types';
import { messageText, parse, uuid } from '../src/validation';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  chatId: 'c1',
  senderId: A,
  text: 'hi',
  seq: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  readBy: {},
  ...overrides,
});

describe('directChatKey', () => {
  it('is the same whichever user comes first', () => {
    assert.equal(directChatKey(A, B), directChatKey(B, A));
  });

  it('ignores letter case', () => {
    assert.equal(directChatKey(A.toUpperCase(), B), directChatKey(A, B));
  });
});

describe('decideReadReceipt', () => {
  it('records the first read', () => {
    assert.deepEqual(decideReadReceipt(message(), B), { record: true });
  });

  it('keeps the original time on a repeat read', () => {
    const readAt = '2026-01-02T00:00:00.000Z';
    assert.deepEqual(decideReadReceipt(message({ readBy: { [B]: readAt } }), B), { record: false, readAt });
  });

  it('treats the sender as having read their own message', () => {
    assert.deepEqual(decideReadReceipt(message(), A), { record: false, readAt: '2026-01-01T00:00:00.000Z' });
  });
});

describe('shouldAdvanceLastSeen', () => {
  it('sets the pointer the first time', () => assert.equal(shouldAdvanceLastSeen(null, 3), true));
  it('moves forward', () => assert.equal(shouldAdvanceLastSeen({ seq: 3 }, 5), true));
  it('does not move for the same message', () => assert.equal(shouldAdvanceLastSeen({ seq: 5 }, 5), false));
  it('never moves backwards', () => assert.equal(shouldAdvanceLastSeen({ seq: 5 }, 2), false));
});

describe('previewOf', () => {
  it('keeps short text and truncates long text', () => {
    assert.equal(previewOf('hello'), 'hello');
    assert.equal(previewOf('x'.repeat(150)).length, 101);
  });
});

describe('validation', () => {
  it('lower-cases UUIDs', () => {
    assert.equal(parse(uuid, A.toUpperCase()), A);
  });

  it('trims message text and rejects blank messages with a 400', () => {
    assert.equal(parse(messageText, '  hi  '), 'hi');
    assert.throws(
      () => parse(messageText, '   '),
      (err: unknown) => err instanceof HttpError && err.status === 400 && err.code === 'VALIDATION_ERROR',
    );
  });
});
