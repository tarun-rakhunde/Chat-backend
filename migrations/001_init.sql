-- Users and chat membership live in PostgreSQL.
-- Messages, read receipts and last-seen pointers live in Firestore.

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name        TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 100),
  -- 1:1 chats only: "<smallerUserId>:<largerUserId>".
  -- The UNIQUE constraint is what makes "create or get" safe under concurrency:
  -- two simultaneous requests for the same pair can never create two chats.
  direct_key  TEXT UNIQUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chats_shape CHECK (
    (type = 'direct' AND direct_key IS NOT NULL AND name IS NULL) OR
    (type = 'group'  AND direct_key IS NULL     AND name IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- The primary key covers lookups by chat; "list a user's chats" needs the other direction.
CREATE INDEX IF NOT EXISTS chat_members_user_id_idx ON chat_members (user_id);
