export type ChatType = 'direct' | 'group';
export type MemberRole = 'admin' | 'member';

export interface ChatMember {
  userId: string;
  role: MemberRole;
  joinedAt: string;
}

export interface Chat {
  id: string;
  type: ChatType;
  /** Group name; always null for 1:1 chats. */
  name: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Ordered by join time (oldest first). */
  members: ChatMember[];
}

/** One row of "list user chats". */
export interface ChatSummary {
  chatId: string;
  type: ChatType;
  name: string | null;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatRepository {
  findById(chatId: string): Promise<Chat | null>;
  /** Idempotent: returns the existing 1:1 chat for `directKey`, or creates it with both users. */
  createOrGetDirect(directKey: string, userIds: [string, string]): Promise<{ chat: Chat; created: boolean }>;
  /** `memberIds` includes the creator, who becomes the group's admin. */
  createGroup(input: { name: string; creatorId: string; memberIds: string[] }): Promise<Chat>;
  /** Most recently updated first. */
  listForUser(userId: string): Promise<ChatSummary[]>;
  /** Adds members; users already in the chat are ignored. */
  addMembers(chatId: string, userIds: string[]): Promise<void>;
  /** Removes a member. If no admin is left, the longest-standing member is promoted. */
  removeMember(chatId: string, userId: string): Promise<void>;
  rename(chatId: string, name: string): Promise<void>;
}
