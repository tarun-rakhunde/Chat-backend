import type { Chat, ChatMember } from './chat.types';

/**
 * Order-independent key for a 1:1 chat: (A, B) and (B, A) give the same key,
 * so the database's UNIQUE constraint can guarantee one chat per pair.
 */
export function directChatKey(userAId: string, userBId: string): string {
  const [first, second] = [userAId.toLowerCase(), userBId.toLowerCase()].sort();
  return `${first}:${second}`;
}

export function findMember(chat: Chat, userId: string): ChatMember | undefined {
  return chat.members.find((member) => member.userId === userId);
}

export function isMember(chat: Chat, userId: string): boolean {
  return findMember(chat, userId) !== undefined;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
