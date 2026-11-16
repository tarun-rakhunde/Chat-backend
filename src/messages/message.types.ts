export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  /** null once the message has been deleted. */
  text: string | null;
  /** Per-chat counter (1, 2, 3, …). Assigned in the same transaction that stamps createdAt. */
  seq: number;
  /** ISO-8601, Firestore server time. */
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** userId -> when that user first read the message. The sender is not listed. */
  readBy: Record<string, string>;
}

export interface MessagePage {
  /** Oldest first. */
  messages: Message[];
  /** Pass as `?before=` to load older messages; null when there are none. */
  nextCursor: number | null;
}

export interface ReadReceipt {
  messageId: string;
  userId: string;
  readAt: string;
  /** true when this call changed nothing (already read, or the user is the sender). */
  alreadyRead: boolean;
}

export interface LastSeen {
  userId: string;
  messageId: string;
  seq: number;
  updatedAt: string;
}

export interface LastSeenUpdate {
  lastSeen: LastSeen;
  /** false when the pointer was already at or past this message. */
  updated: boolean;
}

/** Persistence for messages, read receipts and last-seen pointers (Firestore in production). */
export interface MessageStore {
  create(input: { chatId: string; senderId: string; text: string }): Promise<Message>;
  list(chatId: string, options: { limit: number; beforeSeq?: number }): Promise<MessagePage>;
  markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt>;
  updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate>;
  listLastSeen(chatId: string): Promise<LastSeen[]>;
  edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message>;
  softDelete(chatId: string, messageId: string, userId: string): Promise<Message>;
}
