import { randomUUID } from 'node:crypto';
import type { Chat, ChatRepository, ChatSummary, ChatType } from '../src/chats/chat.types';
import {
  assertIsSender,
  assertNotDeleted,
  decideReadReceipt,
  requireMessage,
  shouldAdvanceLastSeen,
} from '../src/messages/message.rules';
import type {
  LastSeen,
  LastSeenUpdate,
  Message,
  MessagePage,
  MessageStore,
  ReadReceipt,
} from '../src/messages/message.types';
import type { User, UserRepository } from '../src/users/user.types';

// In-memory stand-ins for PostgreSQL and Firestore. They follow the same contracts
// (and the message store uses the same rules module) as the real implementations.

let tick = 0;
/** Strictly increasing timestamps, so ordering in tests is deterministic. */
const nextTime = () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000).toISOString();

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async create(name: string): Promise<User> {
    const user: User = { id: randomUUID(), name, createdAt: nextTime() };
    this.users.set(user.id, user);
    return { ...user };
  }

  async findById(userId: string): Promise<User | null> {
    const user = this.users.get(userId);
    return user ? { ...user } : null;
  }

  async findMissing(userIds: string[]): Promise<string[]> {
    return userIds.filter((id) => !this.users.has(id));
  }
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly chats = new Map<string, Chat>();
  private readonly directKeys = new Map<string, string>();

  async findById(chatId: string): Promise<Chat | null> {
    const chat = this.chats.get(chatId);
    return chat ? structuredClone(chat) : null;
  }

  async createOrGetDirect(directKey: string, userIds: [string, string]): Promise<{ chat: Chat; created: boolean }> {
    const existing = this.directKeys.get(directKey);
    if (existing) return { chat: this.mustGet(existing), created: false };

    const chat = this.insert('direct', null, userIds[0], userIds);
    this.directKeys.set(directKey, chat.id);
    return { chat: structuredClone(chat), created: true };
  }

  async createGroup(input: { name: string; creatorId: string; memberIds: string[] }): Promise<Chat> {
    const chat = this.insert('group', input.name, input.creatorId, input.memberIds);
    for (const member of chat.members) {
      if (member.userId === input.creatorId) member.role = 'admin';
    }
    return structuredClone(chat);
  }

  async listForUser(userId: string): Promise<ChatSummary[]> {
    return [...this.chats.values()]
      .filter((chat) => chat.members.some((member) => member.userId === userId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((chat) => ({
        chatId: chat.id,
        type: chat.type,
        name: chat.name,
        memberIds: chat.members.map((member) => member.userId),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }));
  }

  async addMembers(chatId: string, userIds: string[]): Promise<void> {
    const chat = this.raw(chatId);
    for (const userId of userIds) {
      if (!chat.members.some((member) => member.userId === userId)) {
        chat.members.push({ userId, role: 'member', joinedAt: nextTime() });
      }
    }
    chat.updatedAt = nextTime();
  }

  async removeMember(chatId: string, userId: string): Promise<void> {
    const chat = this.raw(chatId);
    chat.members = chat.members.filter((member) => member.userId !== userId);
    const oldest = chat.members[0];
    if (oldest && !chat.members.some((member) => member.role === 'admin')) oldest.role = 'admin';
    chat.updatedAt = nextTime();
  }

  async rename(chatId: string, name: string): Promise<void> {
    const chat = this.raw(chatId);
    chat.name = name;
    chat.updatedAt = nextTime();
  }

  private insert(type: ChatType, name: string | null, creatorId: string, memberIds: string[]): Chat {
    const time = nextTime();
    const chat: Chat = {
      id: randomUUID(),
      type,
      name,
      createdBy: creatorId,
      createdAt: time,
      updatedAt: time,
      members: memberIds.map((userId) => ({ userId, role: 'member', joinedAt: time })),
    };
    this.chats.set(chat.id, chat);
    return chat;
  }

  private raw(chatId: string): Chat {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`fake: chat ${chatId} not found`);
    return chat;
  }

  private mustGet(chatId: string): Chat {
    return structuredClone(this.raw(chatId));
  }
}

export class InMemoryMessageStore implements MessageStore {
  private readonly byChat = new Map<string, Message[]>();
  private readonly lastSeen = new Map<string, LastSeen>();
  private nextId = 1;

  async create(input: { chatId: string; senderId: string; text: string }): Promise<Message> {
    const messages = this.messages(input.chatId);
    const message: Message = {
      id: `msg${this.nextId++}`,
      chatId: input.chatId,
      senderId: input.senderId,
      text: input.text,
      seq: messages.length + 1,
      createdAt: nextTime(),
      editedAt: null,
      deletedAt: null,
      readBy: {},
    };
    messages.push(message);
    return structuredClone(message);
  }

  async list(chatId: string, options: { limit: number; beforeSeq?: number }): Promise<MessagePage> {
    const { beforeSeq, limit } = options;
    const eligible = this.messages(chatId).filter((m) => beforeSeq === undefined || m.seq < beforeSeq);
    const page = eligible.slice(-limit);
    const oldest = page[0];
    return {
      messages: structuredClone(page),
      nextCursor: eligible.length > limit && oldest ? oldest.seq : null,
    };
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt> {
    const message = requireMessage(this.find(chatId, messageId), messageId);
    const decision = decideReadReceipt(message, userId);
    if (!decision.record) return { messageId, userId, readAt: decision.readAt, alreadyRead: true };

    const readAt = nextTime();
    message.readBy[userId] = readAt;
    return { messageId, userId, readAt, alreadyRead: false };
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate> {
    const message = requireMessage(this.find(chatId, messageId), messageId);
    const key = `${chatId}/${userId}`;
    const updated = shouldAdvanceLastSeen(this.lastSeen.get(key) ?? null, message.seq);
    if (updated) this.lastSeen.set(key, { userId, messageId, seq: message.seq, updatedAt: nextTime() });

    const lastSeen = this.lastSeen.get(key);
    if (!lastSeen) throw new Error('fake: last seen missing');
    return { lastSeen: { ...lastSeen }, updated };
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    return [...this.lastSeen.entries()]
      .filter(([key]) => key.startsWith(`${chatId}/`))
      .map(([, value]) => ({ ...value }));
  }

  async edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message> {
    const message = requireMessage(this.find(chatId, messageId), messageId);
    assertIsSender(message, userId);
    assertNotDeleted(message);
    message.text = text;
    message.editedAt = nextTime();
    return structuredClone(message);
  }

  async softDelete(chatId: string, messageId: string, userId: string): Promise<Message> {
    const message = requireMessage(this.find(chatId, messageId), messageId);
    assertIsSender(message, userId);
    if (message.deletedAt === null) {
      message.text = null;
      message.deletedAt = nextTime();
    }
    return structuredClone(message);
  }

  private messages(chatId: string): Message[] {
    let messages = this.byChat.get(chatId);
    if (!messages) {
      messages = [];
      this.byChat.set(chatId, messages);
    }
    return messages;
  }

  private find(chatId: string, messageId: string): Message | null {
    return this.messages(chatId).find((m) => m.id === messageId) ?? null;
  }
}
