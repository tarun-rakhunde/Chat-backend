/**
 * End-to-end walkthrough of every endpoint against a running server
 * (real PostgreSQL + Firestore/emulator). Each step asserts the expected result.
 *
 *   npm run dev    # terminal 1
 *   npm run demo   # terminal 2
 */
import assert from 'node:assert/strict';
import type { Chat, ChatSummary } from '../src/chats/chat.types';
import type { LastSeen, LastSeenUpdate, Message, MessagePage, ReadReceipt } from '../src/messages/message.types';
import type { User } from '../src/users/user.types';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

interface ApiResponse<T> {
  status: number;
  body: T;
}

async function api<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as T };
}

const step = (title: string) => console.log(`\n▶ ${title}`);
const ok = (detail: string) => console.log(`  ✓ ${detail}`);

async function main(): Promise<void> {
  step('Health check');
  assert.equal((await api('GET', '/health')).status, 200);
  ok(`server is up at ${BASE_URL}`);

  step('Create users (helper endpoint)');
  const createUser = async (name: string) => (await api<{ user: User }>('POST', '/user/create', { name })).body.user;
  const alice = await createUser('Alice');
  const bob = await createUser('Bob');
  const carol = await createUser('Carol');
  ok(`Alice ${alice.id}`);
  ok(`Bob   ${bob.id}`);
  ok(`Carol ${carol.id}`);

  step('1. POST /chat/create (create or get)');
  const created = await api<{ chatId: string; created: boolean }>('POST', '/chat/create', {
    userAId: alice.id,
    userBId: bob.id,
  });
  assert.equal(created.status, 201);
  const chatId = created.body.chatId;
  ok(`created chat ${chatId}`);
  const again = await api<{ chatId: string; created: boolean }>('POST', '/chat/create', {
    userAId: bob.id,
    userBId: alice.id,
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.chatId, chatId);
  ok('calling again with the users swapped returns the same chat (200, created: false)');

  step('2. POST /chat/:chatId/message/send');
  const send = async (senderId: string, text: string) =>
    (await api<{ message: Message }>('POST', `/chat/${chatId}/message/send`, { senderId, text })).body.message;
  const m1 = await send(alice.id, 'Hi Bob!');
  const m2 = await send(bob.id, 'Hey Alice 👋');
  const m3 = await send(alice.id, 'Lunch tomorrow?');
  assert.deepEqual([m1.seq, m2.seq, m3.seq], [1, 2, 3]);
  ok(`sent 3 messages (seq 1-3), first stored at ${m1.createdAt}`);
  const outsider = await api('POST', `/chat/${chatId}/message/send`, { senderId: carol.id, text: 'let me in' });
  assert.equal(outsider.status, 403);
  ok('a non-member gets 403');
  const blank = await api('POST', `/chat/${chatId}/message/send`, { senderId: alice.id, text: '   ' });
  assert.equal(blank.status, 400);
  ok('an empty message gets 400');

  step('3. GET /chat/:chatId/messages?limit=50');
  const all = (await api<MessagePage>('GET', `/chat/${chatId}/messages?limit=50`)).body;
  assert.deepEqual(all.messages.map((m) => m.id), [m1.id, m2.id, m3.id]);
  ok('3 messages, oldest first');
  const page = (await api<MessagePage>('GET', `/chat/${chatId}/messages?limit=2`)).body;
  assert.deepEqual(page.messages.map((m) => m.id), [m2.id, m3.id]);
  assert.equal(page.nextCursor, 2);
  const older = (await api<MessagePage>('GET', `/chat/${chatId}/messages?limit=2&before=${page.nextCursor}`)).body;
  assert.deepEqual(older.messages.map((m) => m.id), [m1.id]);
  ok('limit=2 returns the latest two; ?before=<cursor> pages back to older ones');

  step('4. POST /chat/:chatId/message/:messageId/read');
  const read = async () =>
    (await api<{ receipt: ReadReceipt }>('POST', `/chat/${chatId}/message/${m1.id}/read`, { userId: bob.id })).body
      .receipt;
  const firstRead = await read();
  const secondRead = await read();
  assert.equal(firstRead.alreadyRead, false);
  assert.equal(secondRead.alreadyRead, true);
  assert.equal(secondRead.readAt, firstRead.readAt);
  ok(`Bob read message 1 at ${firstRead.readAt}; repeat calls keep the first read time`);
  const afterRead = (await api<MessagePage>('GET', `/chat/${chatId}/messages`)).body;
  assert.equal(afterRead.messages[0]?.readBy[bob.id], firstRead.readAt);
  ok('the receipt shows up in readBy on GET messages');

  step('5. POST /chat/:chatId/lastseen');
  const lastSeen = async (messageId: string) =>
    (await api<LastSeenUpdate>('POST', `/chat/${chatId}/lastseen`, { userId: bob.id, messageId })).body;
  assert.equal((await lastSeen(m3.id)).updated, true);
  const stale = await lastSeen(m1.id);
  assert.equal(stale.updated, false);
  assert.equal(stale.lastSeen.messageId, m3.id);
  ok('last seen moved to message 3, and an older message cannot move it back');
  const pointers = (await api<{ lastSeen: LastSeen[] }>('GET', `/chat/${chatId}/lastseen`)).body.lastSeen;
  assert.equal(pointers.find((p) => p.userId === bob.id)?.messageId, m3.id);
  ok('GET /chat/:chatId/lastseen lists every member pointer');

  step('6. GET /user/:userId/chats');
  const aliceChats = (await api<{ chats: ChatSummary[] }>('GET', `/user/${alice.id}/chats`)).body.chats;
  const listed = aliceChats.find((c) => c.chatId === chatId);
  assert.deepEqual(listed?.memberIds.slice().sort(), [alice.id, bob.id].sort());
  ok(`Alice has ${aliceChats.length} chat(s), with member ids from PostgreSQL`);

  step('Bonus: group chats');
  const group = (
    await api<{ chatId: string; chat: Chat }>('POST', '/chat/group/create', {
      creatorId: alice.id,
      name: 'Weekend plans',
      memberIds: [bob.id],
    })
  ).body.chat;
  ok(`Alice created group "${group.name}" and is its admin`);
  assert.equal((await api('POST', `/chat/${group.id}/members/add`, { actorId: bob.id, userIds: [carol.id] })).status, 403);
  ok('a non-admin cannot add members (403)');
  const withCarol = (await api<{ chat: Chat }>('POST', `/chat/${group.id}/members/add`, {
    actorId: alice.id,
    userIds: [carol.id],
  })).body.chat;
  assert.equal(withCarol.members.length, 3);
  ok('the admin added Carol');
  const renamed = (await api<{ chat: Chat }>('POST', `/chat/${group.id}/rename`, { actorId: alice.id, name: 'Trip' }))
    .body.chat;
  assert.equal(renamed.name, 'Trip');
  ok('the admin renamed the group');
  const afterLeave = (await api<{ chat: Chat }>('POST', `/chat/${group.id}/members/remove`, {
    actorId: alice.id,
    userId: alice.id,
  })).body.chat;
  assert.equal(afterLeave.members.length, 2);
  assert.equal(afterLeave.members.filter((m) => m.role === 'admin').length, 1);
  ok('when the only admin leaves, the longest-standing member becomes admin');

  step('Bonus: edit and delete messages');
  assert.equal((await api('POST', `/chat/${chatId}/message/${m3.id}/edit`, { userId: bob.id, text: 'x' })).status, 403);
  ok('only the sender can edit (403 for Bob)');
  const edited = (await api<{ message: Message }>('POST', `/chat/${chatId}/message/${m3.id}/edit`, {
    userId: alice.id,
    text: 'Lunch tomorrow at 1?',
  })).body.message;
  assert.equal(edited.text, 'Lunch tomorrow at 1?');
  assert.ok(edited.editedAt);
  ok('Alice edited her message (editedAt is set)');
  const deleted = (await api<{ message: Message }>('POST', `/chat/${chatId}/message/${m2.id}/delete`, {
    userId: bob.id,
  })).body.message;
  assert.equal(deleted.text, null);
  assert.ok(deleted.deletedAt);
  const finalPage = (await api<MessagePage>('GET', `/chat/${chatId}/messages`)).body;
  assert.deepEqual(finalPage.messages.map((m) => m.text), ['Hi Bob!', null, 'Lunch tomorrow at 1?']);
  ok('Bob deleted his message: it keeps its place in the order, without its text');

  console.log('\nAll checks passed ✅');
}

main().catch((err: unknown) => {
  console.error('\nDemo failed ❌');
  console.error(err);
  process.exit(1);
});
