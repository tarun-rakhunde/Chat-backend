import {
  FieldPath,
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from 'firebase-admin/firestore';
import {
  assertIsSender,
  assertNotDeleted,
  decideReadReceipt,
  previewOf,
  requireMessage,
  shouldAdvanceLastSeen,
} from './message.rules';
import type { LastSeen, LastSeenUpdate, Message, MessagePage, MessageStore, ReadReceipt } from './message.types';

/*
 * Firestore layout
 *
 *   chats/{chatId}                         { lastSeq, lastMessage, updatedAt }
 *   chats/{chatId}/messages/{messageId}    { chatId, senderId, text, seq, createdAt,
 *                                            editedAt, deletedAt, readBy: { [userId]: Timestamp } }
 *   chats/{chatId}/lastSeen/{userId}       { userId, messageId, seq, updatedAt }
 *
 * Ordering: each send runs a transaction that reads chats/{chatId}.lastSeq, writes the
 * message with seq = lastSeq + 1 and createdAt = server time, and bumps lastSeq.
 * Sends to the same chat are therefore serialised, so seq follows the same order as
 * createdAt but never ties, which also makes it a simple pagination cursor.
 *
 * lastSeen gets its own document per user (instead of a field on the chat document),
 * so users marking messages as seen don't contend with each other or with new sends.
 */
export class FirestoreMessageStore implements MessageStore {
  constructor(private readonly db: Firestore) {}

  async create(input: { chatId: string; senderId: string; text: string }): Promise<Message> {
    const { chatId, senderId, text } = input;
    const chatRef = this.chatDoc(chatId);
    const messageRef = this.messages(chatId).doc();

    await this.db.runTransaction(async (tx) => {
      const chatSnap = await tx.get(chatRef);
      const lastSeq: unknown = chatSnap.get('lastSeq');
      const seq = (typeof lastSeq === 'number' ? lastSeq : 0) + 1;
      const now = FieldValue.serverTimestamp();

      tx.create(messageRef, {
        chatId,
        senderId,
        text,
        seq,
        createdAt: now,
        editedAt: null,
        deletedAt: null,
        readBy: {},
      });
      tx.set(
        chatRef,
        {
          lastSeq: seq,
          lastMessage: { id: messageRef.id, senderId, text: previewOf(text), seq, createdAt: now, deleted: false },
          updatedAt: now,
        },
        { merge: true },
      );
    });

    return this.mustGetMessage(messageRef, chatId);
  }

  async list(chatId: string, options: { limit: number; beforeSeq?: number }): Promise<MessagePage> {
    // Newest first so `limit` keeps the latest messages, then flip to oldest-first for display.
    let query: Query = this.messages(chatId).orderBy('seq', 'desc');
    if (options.beforeSeq !== undefined) query = query.where('seq', '<', options.beforeSeq);

    // Fetch one extra document to know whether an older page exists.
    const snapshot = await query.limit(options.limit + 1).get();
    const messages = snapshot.docs
      .slice(0, options.limit)
      .map((doc) => toMessage(doc.id, chatId, doc.data()))
      .reverse();

    const oldest = messages[0];
    const hasMore = snapshot.docs.length > options.limit;
    return { messages, nextCursor: hasMore && oldest ? oldest.seq : null };
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt> {
    const messageRef = this.messages(chatId).doc(messageId);

    const decision = await this.db.runTransaction(async (tx) => {
      const message = requireMessage(readMessage(await tx.get(messageRef), chatId), messageId);
      const result = decideReadReceipt(message, userId);
      if (result.record) {
        // FieldPath keeps the user id as one field name, whatever characters it contains.
        tx.update(messageRef, new FieldPath('readBy', userId), FieldValue.serverTimestamp());
      }
      return result;
    });

    if (!decision.record) {
      return { messageId, userId, readAt: decision.readAt, alreadyRead: true };
    }
    const message = await this.mustGetMessage(messageRef, chatId);
    const readAt = message.readBy[userId];
    if (!readAt) throw new Error(`Read receipt for ${userId} missing right after it was written`);
    return { messageId, userId, readAt, alreadyRead: false };
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate> {
    const messageRef = this.messages(chatId).doc(messageId);
    const lastSeenRef = this.lastSeenDocs(chatId).doc(userId);

    const updated = await this.db.runTransaction(async (tx) => {
      const [messageSnap, lastSeenSnap] = await Promise.all([tx.get(messageRef), tx.get(lastSeenRef)]);
      const message = requireMessage(readMessage(messageSnap, chatId), messageId);

      if (!shouldAdvanceLastSeen(readLastSeen(lastSeenSnap), message.seq)) return false;
      tx.set(lastSeenRef, {
        userId,
        messageId,
        seq: message.seq,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    const lastSeen = readLastSeen(await lastSeenRef.get());
    if (!lastSeen) throw new Error(`Last-seen for ${userId} missing right after it was written`);
    return { lastSeen, updated };
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    const snapshot = await this.lastSeenDocs(chatId).get();
    return snapshot.docs.map((doc) => toLastSeen(doc.data()));
  }

  async edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message> {
    const chatRef = this.chatDoc(chatId);
    const messageRef = this.messages(chatId).doc(messageId);

    await this.db.runTransaction(async (tx) => {
      const [messageSnap, chatSnap] = await Promise.all([tx.get(messageRef), tx.get(chatRef)]);
      const message = requireMessage(readMessage(messageSnap, chatId), messageId);
      assertIsSender(message, userId);
      assertNotDeleted(message);

      tx.update(messageRef, { text, editedAt: FieldValue.serverTimestamp() });
      // Keep the chat's "last message" preview in sync if this was the latest message.
      if (chatSnap.get('lastMessage.id') === messageId) {
        tx.update(chatRef, { 'lastMessage.text': previewOf(text) });
      }
    });

    return this.mustGetMessage(messageRef, chatId);
  }

  /** Soft delete: the message keeps its place (seq) and receipts, but its text is removed. Idempotent. */
  async softDelete(chatId: string, messageId: string, userId: string): Promise<Message> {
    const chatRef = this.chatDoc(chatId);
    const messageRef = this.messages(chatId).doc(messageId);

    await this.db.runTransaction(async (tx) => {
      const [messageSnap, chatSnap] = await Promise.all([tx.get(messageRef), tx.get(chatRef)]);
      const message = requireMessage(readMessage(messageSnap, chatId), messageId);
      assertIsSender(message, userId);
      if (message.deletedAt !== null) return;

      tx.update(messageRef, { text: null, deletedAt: FieldValue.serverTimestamp() });
      if (chatSnap.get('lastMessage.id') === messageId) {
        tx.update(chatRef, { 'lastMessage.text': null, 'lastMessage.deleted': true });
      }
    });

    return this.mustGetMessage(messageRef, chatId);
  }

  // ---- references & helpers ------------------------------------------------

  private chatDoc(chatId: string): DocumentReference {
    return this.db.collection('chats').doc(chatId);
  }

  private messages(chatId: string): CollectionReference {
    return this.chatDoc(chatId).collection('messages');
  }

  private lastSeenDocs(chatId: string): CollectionReference {
    return this.chatDoc(chatId).collection('lastSeen');
  }

  private async mustGetMessage(ref: DocumentReference, chatId: string): Promise<Message> {
    const message = readMessage(await ref.get(), chatId);
    if (!message) throw new Error(`Message ${ref.id} missing right after it was written`);
    return message;
  }
}

// ---- Firestore document -> API object ---------------------------------------

function readMessage(snapshot: DocumentSnapshot, chatId: string): Message | null {
  const data = snapshot.data();
  return snapshot.exists && data ? toMessage(snapshot.id, chatId, data) : null;
}

function readLastSeen(snapshot: DocumentSnapshot): LastSeen | null {
  const data = snapshot.data();
  return snapshot.exists && data ? toLastSeen(data) : null;
}

function toMessage(id: string, chatId: string, data: DocumentData): Message {
  return {
    id,
    chatId,
    senderId: String(data.senderId),
    text: typeof data.text === 'string' ? data.text : null,
    seq: Number(data.seq),
    createdAt: toIso(data.createdAt) ?? new Date(0).toISOString(),
    editedAt: toIso(data.editedAt),
    deletedAt: toIso(data.deletedAt),
    readBy: toIsoMap(data.readBy),
  };
}

function toLastSeen(data: DocumentData): LastSeen {
  return {
    userId: String(data.userId),
    messageId: String(data.messageId),
    seq: Number(data.seq),
    updatedAt: toIso(data.updatedAt) ?? new Date(0).toISOString(),
  };
}

function toIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function toIsoMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return result;
  for (const [key, entry] of Object.entries(value)) {
    const iso = toIso(entry);
    if (iso) result[key] = iso;
  }
  return result;
}
