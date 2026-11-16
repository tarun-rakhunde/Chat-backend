import type { Pool } from 'pg';
import type { User, UserRepository } from './user.types';

interface UserRow {
  id: string;
  name: string;
  created_at: Date;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at.toISOString(),
});

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(name: string): Promise<User> {
    const { rows } = await this.pool.query<UserRow>(
      'INSERT INTO users (name) VALUES ($1) RETURNING id, name, created_at',
      [name],
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT INTO users returned no row');
    return toUser(row);
  }

  async findById(userId: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, name, created_at FROM users WHERE id = $1',
      [userId],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findMissing(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const { rows } = await this.pool.query<{ id: string }>(
      'SELECT id::text AS id FROM users WHERE id = ANY($1::uuid[])',
      [userIds],
    );
    const found = new Set(rows.map((row) => row.id));
    return userIds.filter((id) => !found.has(id));
  }
}
