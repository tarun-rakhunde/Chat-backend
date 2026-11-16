import type { Pool } from 'pg';
import { withTransaction } from '../infra/postgres';
import type { Chat, ChatRepository, ChatSummary, ChatType, MemberRole } from './chat.types';

interface ChatRow {
  id: string;
  type: ChatType;
  name: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  members: Array<{ userId: string; role: MemberRole; joinedAt: string }>;
}

interface ChatSummaryRow {
  id: string;
  type: ChatType;
  name: string | null;
  member_ids: string[];
  created_at: Date;
  updated_at: Date;
}

// One query returns a chat together with its members (as JSON), ordered by join time.
const SELECT_CHAT_WITH_MEMBERS = `
  SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.updated_at,
         COALESCE(
           json_agg(
             json_build_object('userId', m.user_id, 'role', m.role, 'joinedAt', m.joined_at)
             ORDER BY m.joined_at, m.user_id
           ) FILTER (WHERE m.user_id IS NOT NULL),
           '[]'::json
         ) AS members
  FROM chats c
  LEFT JOIN chat_members m ON m.chat_id = c.id
  WHERE c.id = $1
  GROUP BY c.id`;

const toChat = (row: ChatRow): Chat => ({
  id: row.id,
  type: row.type,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  members: row.members.map((member) => ({
    userId: member.userId,
    role: member.role,
    joinedAt: new Date(member.joinedAt).toISOString(),
  })),
});

export class PgChatRepository implements ChatRepository {
  constructor(private readonly pool: Pool) {}

  async findById(chatId: string): Promise<Chat | null> {
    const { rows } = await this.pool.query<ChatRow>(SELECT_CHAT_WITH_MEMBERS, [chatId]);
    return rows[0] ? toChat(rows[0]) : null;
  }

  async createOrGetDirect(
    directKey: string,
    [userAId, userBId]: [string, string],
  ): Promise<{ chat: Chat; created: boolean }> {
    const result = await withTransaction(this.pool, async (client) => {
      // If another request created this pair's chat first, ON CONFLICT makes us
      // wait for it to commit and then insert nothing, so we fall through to the SELECT.
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO chats (type, direct_key, created_by)
         VALUES ('direct', $1, $2)
         ON CONFLICT (direct_key) DO NOTHING
         RETURNING id`,
        [directKey, userAId],
      );

      const newChat = inserted.rows[0];
      if (newChat) {
        await client.query(
          'INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2), ($1, $3)',
          [newChat.id, userAId, userBId],
        );
        return { chatId: newChat.id, created: true };
      }

      const existing = await client.query<{ id: string }>(
        'SELECT id FROM chats WHERE direct_key = $1',
        [directKey],
      );
      const existingChat = existing.rows[0];
      if (!existingChat) throw new Error(`Direct chat ${directKey} conflicted but could not be found`);
      return { chatId: existingChat.id, created: false };
    });

    return { chat: await this.mustFind(result.chatId), created: result.created };
  }

  async createGroup(input: { name: string; creatorId: string; memberIds: string[] }): Promise<Chat> {
    const chatId = await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO chats (type, name, created_by) VALUES ('group', $1, $2) RETURNING id`,
        [input.name, input.creatorId],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('INSERT INTO chats returned no row');

      await client.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         SELECT $1, member_id, CASE WHEN member_id = $2::uuid THEN 'admin' ELSE 'member' END
         FROM unnest($3::uuid[]) AS member_id`,
        [id, input.creatorId, input.memberIds],
      );
      return id;
    });

    return this.mustFind(chatId);
  }

  async listForUser(userId: string): Promise<ChatSummary[]> {
    const { rows } = await this.pool.query<ChatSummaryRow>(
      `SELECT c.id, c.type, c.name, c.created_at, c.updated_at,
              array_agg(m.user_id::text ORDER BY m.joined_at, m.user_id) AS member_ids
       FROM chat_members me
       JOIN chats c        ON c.id = me.chat_id
       JOIN chat_members m ON m.chat_id = c.id
       WHERE me.user_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC, c.id`,
      [userId],
    );

    return rows.map((row) => ({
      chatId: row.id,
      type: row.type,
      name: row.name,
      memberIds: row.member_ids,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async addMembers(chatId: string, userIds: string[]): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO chat_members (chat_id, user_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [chatId, userIds],
      );
      await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
    });
  }

  async removeMember(chatId: string, userId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      // Lock the chat row so concurrent membership changes to this chat run one at a time.
      await client.query('SELECT id FROM chats WHERE id = $1 FOR UPDATE', [chatId]);
      await client.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);

      // A group must keep an admin: promote the longest-standing member if none is left.
      await client.query(
        `UPDATE chat_members SET role = 'admin'
         WHERE chat_id = $1
           AND NOT EXISTS (SELECT 1 FROM chat_members WHERE chat_id = $1 AND role = 'admin')
           AND user_id = (
             SELECT user_id FROM chat_members WHERE chat_id = $1
             ORDER BY joined_at, user_id
             LIMIT 1
           )`,
        [chatId],
      );
      await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
    });
  }

  async rename(chatId: string, name: string): Promise<void> {
    await this.pool.query('UPDATE chats SET name = $2, updated_at = now() WHERE id = $1', [chatId, name]);
  }

  private async mustFind(chatId: string): Promise<Chat> {
    const chat = await this.findById(chatId);
    if (!chat) throw new Error(`Chat ${chatId} not found right after it was written`);
    return chat;
  }
}
