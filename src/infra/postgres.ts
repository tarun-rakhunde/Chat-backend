import { Pool, type PoolClient } from 'pg';

export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 10 });
  // An idle client can error (e.g. the DB restarts). Log it instead of crashing the process.
  pool.on('error', (err) => console.error('Unexpected Postgres pool error:', err));
  return pool;
}

/** Runs `fn` inside BEGIN/COMMIT on one connection, rolling back if it throws. */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
