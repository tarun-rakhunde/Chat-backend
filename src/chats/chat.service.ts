import { badRequest, forbidden, notFound } from '../errors';
import type { UserRepository } from '../users/user.types';
import { directChatKey, findMember, isMember, unique } from './chat.rules';
import type { Chat, ChatRepository, ChatSummary } from './chat.types';

export class ChatService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly users: UserRepository,
  ) {}

  /** 1. Create or Get Chat. Calling it again, in either user order, returns the same chat. */
  async createOrGetDirectChat(userAId: string, userBId: string): Promise<{ chat: Chat; created: boolean }> {
    if (userAId === userBId) {
      throw badRequest('SAME_USER', 'A 1:1 chat needs two different users');
    }
    await this.assertUsersExist([userAId, userBId]);
    return this.chats.createOrGetDirect(directChatKey(userAId, userBId), [userAId, userBId]);
  }

  async getChat(chatId: string): Promise<Chat> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw notFound('CHAT_NOT_FOUND', `Chat ${chatId} does not exist`);
    return chat;
  }

  /** 6. List User Chats */
  async listUserChats(userId: string): Promise<ChatSummary[]> {
    const user = await this.users.findById(userId);
    if (!user) throw notFound('USER_NOT_FOUND', `User ${userId} does not exist`);
    return this.chats.listForUser(userId);
  }

  // ---- Group chats (bonus) -------------------------------------------------

  async createGroupChat(creatorId: string, name: string, memberIds: string[]): Promise<Chat> {
    const allMembers = unique([creatorId, ...memberIds]);
    if (allMembers.length < 2) {
      throw badRequest('GROUP_TOO_SMALL', 'A group needs at least one member besides the creator');
    }
    await this.assertUsersExist(allMembers);
    return this.chats.createGroup({ name, creatorId, memberIds: allMembers });
  }

  /** Admins only. Users who are already members are ignored. */
  async addMembers(chatId: string, actorId: string, userIds: string[]): Promise<Chat> {
    const chat = await this.requireGroupAdmin(chatId, actorId);
    const newMemberIds = unique(userIds).filter((id) => !isMember(chat, id));
    if (newMemberIds.length > 0) {
      await this.assertUsersExist(newMemberIds);
      await this.chats.addMembers(chatId, newMemberIds);
    }
    return this.getChat(chatId);
  }

  /** Admins can remove anyone; any member can remove themselves (leave). */
  async removeMember(chatId: string, actorId: string, userId: string): Promise<Chat> {
    const chat = await this.requireGroup(chatId);
    const actor = findMember(chat, actorId);
    if (!actor) throw forbidden('NOT_A_MEMBER', `User ${actorId} is not a member of this chat`);

    const leaving = actorId === userId;
    if (!leaving && actor.role !== 'admin') {
      throw forbidden('ADMIN_ONLY', 'Only group admins can remove other members');
    }
    if (!isMember(chat, userId)) {
      throw notFound('MEMBER_NOT_FOUND', `User ${userId} is not a member of this chat`);
    }

    await this.chats.removeMember(chatId, userId);
    return this.getChat(chatId);
  }

  async renameGroup(chatId: string, actorId: string, name: string): Promise<Chat> {
    await this.requireGroupAdmin(chatId, actorId);
    await this.chats.rename(chatId, name);
    return this.getChat(chatId);
  }

  // ---- helpers -------------------------------------------------------------

  private async requireGroup(chatId: string): Promise<Chat> {
    const chat = await this.getChat(chatId);
    if (chat.type !== 'group') {
      throw badRequest('NOT_A_GROUP', 'This operation is only available for group chats');
    }
    return chat;
  }

  private async requireGroupAdmin(chatId: string, actorId: string): Promise<Chat> {
    const chat = await this.requireGroup(chatId);
    const actor = findMember(chat, actorId);
    if (!actor) throw forbidden('NOT_A_MEMBER', `User ${actorId} is not a member of this chat`);
    if (actor.role !== 'admin') throw forbidden('ADMIN_ONLY', 'Only group admins can do this');
    return chat;
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const missing = await this.users.findMissing(userIds);
    if (missing.length > 0) {
      throw notFound('USER_NOT_FOUND', `Unknown user id(s): ${missing.join(', ')}`, { missing });
    }
  }
}
