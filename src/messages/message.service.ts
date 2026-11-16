import { isMember } from '../chats/chat.rules';
import type { Chat, ChatRepository } from '../chats/chat.types';
import { forbidden, notFound } from '../errors';
import type { LastSeen, LastSeenUpdate, Message, MessagePage, MessageStore, ReadReceipt } from './message.types';

/**
 * Message operations. Chat existence and membership come from PostgreSQL (the source of
 * truth for who is in a chat); the messages themselves live in the MessageStore (Firestore).
 */
export class MessageService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly store: MessageStore,
  ) {}

  /** 2. Send Message */
  async send(chatId: string, senderId: string, text: string): Promise<Message> {
    await this.requireMember(chatId, senderId);
    return this.store.create({ chatId, senderId, text });
  }

  /** 3. Get Messages — oldest first, newest `limit` messages (or those before `beforeSeq`). */
  async list(chatId: string, options: { limit: number; beforeSeq?: number }): Promise<MessagePage> {
    await this.requireChat(chatId);
    return this.store.list(chatId, options);
  }

  /** 4. Mark Message Read */
  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt> {
    await this.requireMember(chatId, userId);
    return this.store.markRead(chatId, messageId, userId);
  }

  /** 5. Update Last Seen Message */
  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate> {
    await this.requireMember(chatId, userId);
    return this.store.updateLastSeen(chatId, userId, messageId);
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    await this.requireChat(chatId);
    return this.store.listLastSeen(chatId);
  }

  /** Bonus: edit (sender only). */
  async edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message> {
    await this.requireMember(chatId, userId);
    return this.store.edit(chatId, messageId, userId, text);
  }

  /** Bonus: delete (sender only, soft delete). */
  async delete(chatId: string, messageId: string, userId: string): Promise<Message> {
    await this.requireMember(chatId, userId);
    return this.store.softDelete(chatId, messageId, userId);
  }

  private async requireChat(chatId: string): Promise<Chat> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw notFound('CHAT_NOT_FOUND', `Chat ${chatId} does not exist`);
    return chat;
  }

  private async requireMember(chatId: string, userId: string): Promise<Chat> {
    const chat = await this.requireChat(chatId);
    if (!isMember(chat, userId)) {
      throw forbidden('NOT_A_MEMBER', `User ${userId} is not a member of chat ${chatId}`);
    }
    return chat;
  }
}
