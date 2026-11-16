import { conflict, forbidden, notFound } from '../errors';
import type { LastSeen, Message } from './message.types';

// Pure business rules, shared by the Firestore store and the in-memory test store,
// so the tests exercise exactly the logic that runs in production.

export const PREVIEW_LENGTH = 100;

export function requireMessage(message: Message | null, messageId: string): Message {
  if (!message) throw notFound('MESSAGE_NOT_FOUND', `Message ${messageId} does not exist in this chat`);
  return message;
}

export type ReadDecision = { record: true } | { record: false; readAt: string };

/**
 * Read receipts keep the FIRST time a user read a message, so repeated calls are harmless.
 * The sender has implicitly read their own message.
 */
export function decideReadReceipt(message: Message, userId: string): ReadDecision {
  if (message.senderId === userId) return { record: false, readAt: message.createdAt };
  const existing = message.readBy[userId];
  return existing ? { record: false, readAt: existing } : { record: true };
}

/**
 * The last-seen pointer only moves forward. A late or out-of-order request for an
 * older message (e.g. a second device catching up) must not move it back.
 */
export function shouldAdvanceLastSeen(current: Pick<LastSeen, 'seq'> | null, targetSeq: number): boolean {
  return current === null || targetSeq > current.seq;
}

/** Only the sender may edit or delete their message. */
export function assertIsSender(message: Message, userId: string): void {
  if (message.senderId !== userId) {
    throw forbidden('NOT_MESSAGE_SENDER', 'Only the sender can edit or delete this message');
  }
}

export function assertNotDeleted(message: Message): void {
  if (message.deletedAt !== null) {
    throw conflict('MESSAGE_DELETED', 'This message has been deleted');
  }
}

export function previewOf(text: string): string {
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
}
