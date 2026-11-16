# Chat Backend: PostgreSQL + Firebase Firestore

A chat backend in **Node.js + TypeScript (strict)**:

- **PostgreSQL** stores users, chats and who belongs to which chat.
- **Firebase Firestore** stores messages, read receipts and each user's last-seen message.

It covers all six required APIs (1:1 chats, sending, ordered history, read receipts, last seen, a user's chat list) and both bonuses: group chats with admin management, and message edit/delete.

---

## Quick start

**Requirements:** Node.js 20.12+ and Docker.

```bash
# 1. Start PostgreSQL and the Firestore emulator
docker compose up -d

# 2. Configure (defaults point at the containers above)
cp .env.example .env

# 3. Install, create the tables and run the server
npm install
npm run db:migrate
npm run dev            # http://localhost:3000
```

Then, in a second terminal, run the **end-to-end demo**. It calls every endpoint against the running server and asserts each result:

```bash
npm run demo
```

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build && npm start` (compiled build), `npm run db:seed` (creates three demo users and prints their ids).

> **Using a real Firebase project instead of the emulator:** remove `FIRESTORE_EMULATOR_HOST` from `.env`, set `FIREBASE_PROJECT_ID`, and point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account key file.
> **Without Docker for Firestore:** `npx firebase-tools emulators:start --only firestore --project demo-chat` also serves the emulator on port 8080.

---

## API

All request and response bodies are JSON. User and chat ids are UUIDs. Message ids are Firestore document ids.

### Required endpoints

| # | Method & path | Body / query | Response |
|---|---|---|---|
| 1 | `POST /chat/create` | `{ userAId, userBId }` | `201 { chatId, created: true }` on create, `200 { chatId, created: false }` if the chat already exists |
| 2 | `POST /chat/:chatId/message/send` | `{ senderId, text }` | `201 { message }` |
| 3 | `GET /chat/:chatId/messages` | `?limit=50` (1–100, default 50), optional `&before=<seq>` | `200 { messages, nextCursor }`, oldest first |
| 4 | `POST /chat/:chatId/message/:messageId/read` | `{ userId }` | `200 { receipt: { messageId, userId, readAt, alreadyRead } }` |
| 5 | `POST /chat/:chatId/lastseen` | `{ userId, messageId }` | `200 { lastSeen: { userId, messageId, seq, updatedAt }, updated }` |
| 6 | `GET /user/:userId/chats` | – | `200 { userId, chats: [{ chatId, type, name, memberIds, createdAt, updatedAt }] }` |

### Bonus and helper endpoints

| Method & path | Body | Notes |
|---|---|---|
| `POST /user/create` | `{ name }` | Helper to create users for testing |
| `GET /chat/:chatId` | – | Chat with members and their roles |
| `GET /chat/:chatId/lastseen` | – | Every member's last-seen pointer |
| `POST /chat/group/create` | `{ creatorId, name, memberIds }` | Creator becomes admin |
| `POST /chat/:chatId/members/add` | `{ actorId, userIds }` | Admins only; existing members are ignored |
| `POST /chat/:chatId/members/remove` | `{ actorId, userId }` | Admins remove anyone; members can remove themselves (leave) |
| `POST /chat/:chatId/rename` | `{ actorId, name }` | Admins only |
| `POST /chat/:chatId/message/:messageId/edit` | `{ userId, text }` | Sender only; sets `editedAt` |
| `POST /chat/:chatId/message/:messageId/delete` | `{ userId }` | Sender only; soft delete, idempotent |

### Message shape

```json
{
  "id": "Qm3b8kT0bXyR1sHq2LpA",
  "chatId": "6f1c0a7e-1b8e-4a53-9a43-0c6f5e2b9d11",
  "senderId": "0b8f…",
  "text": "Lunch tomorrow?",
  "seq": 3,
  "createdAt": "2026-11-16T16:20:11.482Z",
  "editedAt": null,
  "deletedAt": null,
  "readBy": { "9c2e…": "2026-11-16T16:21:03.107Z" }
}
```

### Errors

Every error uses one shape, with a stable machine-readable `code`:

```json
{ "error": { "code": "NOT_A_MEMBER", "message": "User … is not a member of chat …" } }
```

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` (with per-field `details`), `INVALID_REQUEST_BODY`, `SAME_USER`, `GROUP_TOO_SMALL`, `NOT_A_GROUP` |
| 403 | `NOT_A_MEMBER`, `ADMIN_ONLY`, `NOT_MESSAGE_SENDER` |
| 404 | `USER_NOT_FOUND`, `CHAT_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `MEMBER_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `MESSAGE_DELETED` |

### Example with curl

```bash
curl -X POST localhost:3000/user/create -H 'content-type: application/json' -d '{"name":"Alice"}'
curl -X POST localhost:3000/chat/create -H 'content-type: application/json' \
     -d '{"userAId":"<alice-id>","userBId":"<bob-id>"}'
curl -X POST localhost:3000/chat/<chat-id>/message/send -H 'content-type: application/json' \
     -d '{"senderId":"<alice-id>","text":"Hi Bob!"}'
curl 'localhost:3000/chat/<chat-id>/messages?limit=50'
```

---

## Data model

### PostgreSQL ([`migrations/001_init.sql`](migrations/001_init.sql))

```
users         (id uuid PK, name, created_at)
chats         (id uuid PK, type 'direct'|'group', name, direct_key UNIQUE, created_by, created_at, updated_at)
chat_members  (chat_id, user_id) PK, role 'admin'|'member', joined_at
              + index on (user_id) for "list a user's chats"
```

A `CHECK` constraint enforces the two chat shapes: a 1:1 chat has a `direct_key` and no name, and a group has a name and no `direct_key`.

### Firestore

```
chats/{chatId}                        { lastSeq, lastMessage, updatedAt }
chats/{chatId}/messages/{messageId}   { chatId, senderId, text, seq, createdAt, editedAt, deletedAt, readBy }
chats/{chatId}/lastSeen/{userId}      { userId, messageId, seq, updatedAt }
```

The Firestore `chatId` is the PostgreSQL chat UUID, which links the two stores.

---

## Design decisions

**Why the split?** Chat membership is relational data with integrity rules (foreign keys, unique pairs, roles), so it lives in PostgreSQL, the source of truth for who may access a chat. Messages are high-volume, append-mostly documents that clients typically subscribe to in real time, so they live in Firestore. Every message operation first checks chat membership in PostgreSQL, then reads or writes Firestore.

**"Create or get" is race-safe.** A 1:1 chat's `direct_key` is the two user ids, sorted and joined (`"<smaller>:<larger>"`), so `(A, B)` and `(B, A)` map to the same key. It has a `UNIQUE` constraint, and the insert uses `ON CONFLICT DO NOTHING`. If two requests arrive at the same moment, the second one waits for the first to commit, inserts nothing, and returns the same chat. I verified this against PostgreSQL 16 with two overlapping transactions. UUIDs are lower-cased on input, so letter case can't create duplicates either.

**Message ordering.** Each send runs a Firestore transaction that reads `chats/{chatId}.lastSeq`, writes the message with `seq = lastSeq + 1` and `createdAt = serverTimestamp()`, and bumps `lastSeq`. Sends to one chat are therefore serialised, so `seq` follows the same order as the server timestamp, but it can never tie, even for messages sent in the same instant. `seq` is also a simple cursor for paging (`?before=<seq>`). `GET messages` returns the newest `limit` messages, oldest first, which is how a chat screen displays them. *Trade-off:* this puts every send for one chat through one Firestore document. That is fine for human conversations, but a very busy group chat would need a sharded counter or ordering by `createdAt` alone.

**Read receipts** are stored on the message as `readBy.{userId} = timestamp`. The first read wins: repeat calls return the original time with `alreadyRead: true`, so clients can retry safely. The sender is treated as having read their own message. Writes use a `FieldPath`, so a user id is always one field name.

**Last seen only moves forward.** It is stored in its own document per user, so users don't contend with each other or with sends. The update compares `seq` inside a transaction: an older message (a slow second device, or an out-of-order request) can't move the pointer backwards, and the response says whether anything changed (`updated`).

**Delete is a soft delete.** The text is cleared and `deletedAt` is set, but the message keeps its `seq` and receipts, so ordering, cursors and last-seen pointers stay valid. Clients show "This message was deleted". The chat's `lastMessage` preview is kept in sync on edit and delete.

**Groups always keep an admin.** If the last admin leaves, the longest-standing member is promoted in the same database transaction.

**Code structure.** Routes only validate input (zod) and shape responses. Services hold the business rules. Repositories and stores talk to PostgreSQL and Firestore behind interfaces. Pure rules (`*.rules.ts`), such as "last seen never moves backwards", are shared by the Firestore store and the in-memory test store, so the unit tests exercise the production logic. Strict TypeScript adds `noUncheckedIndexedAccess`, and the environment is validated at startup.

---

## Testing

- **`npm test`**: 34 unit tests (Node's built-in test runner). They cover the services and rules: create-or-get idempotency, membership and admin checks, ordering and pagination, first-read-wins receipts, forward-only last seen, and edit/delete permissions. They run against in-memory repositories, so no database is needed.
- **`npm run demo`**: an end-to-end run of every endpoint against the real PostgreSQL and Firestore emulator, with an assertion on each step.

---

## Assumptions and next steps

- **Authentication** is out of scope, as in the spec: the acting user comes from the request body (`senderId`, `userId`, `actorId`). In production it would come from a verified token (JWT or Firebase Auth), and the body fields would go away.
- **Real-time delivery:** clients can subscribe to `chats/{chatId}/messages` with Firestore listeners. That would need Firestore security rules that mirror the PostgreSQL membership, for example via custom claims.
- **Cross-database consistency:** a chat is created in PostgreSQL before any Firestore write, and Firestore writes are transactional, so a failed send leaves nothing half-written. An idempotency key on send would make client retries fully safe.
- Possible extras: unread counts (`lastSeq − lastSeen.seq`), last-message previews in the chat list (one `getAll` on the chat documents), rate limiting, and request logging.

## Project structure

```
src/
  server.ts              wiring + startup/shutdown
  app.ts                 express app (routes, JSON, error handling)
  config.ts              env validation
  errors.ts, errorHandler.ts, validation.ts
  infra/                 postgres pool, firestore init, migrate + seed scripts
  users/                 user repository, service, routes
  chats/                 chat types, rules, repository (PostgreSQL), service, routes
  messages/              message types, rules, store (Firestore), service, routes
migrations/              SQL migrations
test/                    unit tests + in-memory fakes
scripts/demo.ts          end-to-end walkthrough
```
