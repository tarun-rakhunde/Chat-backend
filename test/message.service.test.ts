import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ChatService } from '../src/chats/chat.service';
import { MessageService } from '../src/messages/message.service';
import { InMemoryChatRepository, InMemoryMessageStore, InMemoryUserRepository } from './fakes';
import { expectHttpError } from './helpers';

async function setup() {
  const users = new InMemoryUserRepository();
  const chatRepository = new InMemoryChatRepository();
  const chats = new ChatService(chatRepository, users);
  const messages = new MessageService(chatRepository, new InMemoryMessageStore());

  const alice = await users.create('Alice');
  const bob = await users.create('Bob');
  const carol = await users.create('Carol');
  const { chat } = await chats.createOrGetDirectChat(alice.id, bob.id);
  return { messages, alice, bob, carol, chatId: chat.id };
}

describe('MessageService: sending', () => {
  it('only lets chat members send', async () => {
    const { messages, carol, chatId } = await setup();
    await expectHttpError(messages.send(chatId, carol.id, 'hi'), 403, 'NOT_A_MEMBER');
  });

  it('404s for an unknown chat', async () => {
    const { messages, alice } = await setup();
    await expectHttpError(messages.send(randomUUID(), alice.id, 'hi'), 404, 'CHAT_NOT_FOUND');
  });

  it('numbers messages in send order', async () => {
    const { messages, alice, bob, chatId } = await setup();
    const first = await messages.send(chatId, alice.id, 'one');
    const second = await messages.send(chatId, bob.id, 'two');
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
  });
});

describe('MessageService: reading messages', () => {
  it('returns the latest `limit` messages oldest-first, with a cursor for older pages', async () => {
    const { messages, alice, chatId } = await setup();
    for (let i = 1; i <= 5; i++) await messages.send(chatId, alice.id, `message ${i}`);

    const latest = await messages.list(chatId, { limit: 2 });
    assert.deepEqual(latest.messages.map((m) => m.text), ['message 4', 'message 5']);
    assert.equal(latest.nextCursor, 4);

    const older = await messages.list(chatId, { limit: 10, beforeSeq: latest.nextCursor ?? undefined });
    assert.deepEqual(older.messages.map((m) => m.text), ['message 1', 'message 2', 'message 3']);
    assert.equal(older.nextCursor, null);
  });
});

describe('MessageService: read receipts', () => {
  it('records the first read and keeps it on repeat calls', async () => {
    const { messages, alice, bob, chatId } = await setup();
    const sent = await messages.send(chatId, alice.id, 'hello');

    const first = await messages.markRead(chatId, sent.id, bob.id);
    const repeat = await messages.markRead(chatId, sent.id, bob.id);

    assert.equal(first.alreadyRead, false);
    assert.equal(repeat.alreadyRead, true);
    assert.equal(repeat.readAt, first.readAt);
    const [stored] = (await messages.list(chatId, { limit: 50 })).messages;
    assert.equal(stored?.readBy[bob.id], first.readAt);
  });

  it('treats the sender as having already read their message', async () => {
    const { messages, alice, chatId } = await setup();
    const sent = await messages.send(chatId, alice.id, 'hello');
    assert.equal((await messages.markRead(chatId, sent.id, alice.id)).alreadyRead, true);
  });

  it('404s for an unknown message and 403s for non-members', async () => {
    const { messages, bob, carol, chatId } = await setup();
    await expectHttpError(messages.markRead(chatId, 'missing', bob.id), 404, 'MESSAGE_NOT_FOUND');
    await expectHttpError(messages.markRead(chatId, 'missing', carol.id), 403, 'NOT_A_MEMBER');
  });
});

describe('MessageService: last seen', () => {
  it('moves forward but never backwards', async () => {
    const { messages, alice, bob, chatId } = await setup();
    const m1 = await messages.send(chatId, alice.id, 'one');
    const m2 = await messages.send(chatId, alice.id, 'two');

    const toSecond = await messages.updateLastSeen(chatId, bob.id, m2.id);
    const backToFirst = await messages.updateLastSeen(chatId, bob.id, m1.id);

    assert.equal(toSecond.updated, true);
    assert.equal(backToFirst.updated, false);
    assert.equal(backToFirst.lastSeen.messageId, m2.id);
    assert.deepEqual(
      (await messages.listLastSeen(chatId)).map((entry) => [entry.userId, entry.messageId]),
      [[bob.id, m2.id]],
    );
  });
});

describe('MessageService: edit and delete', () => {
  it('lets only the sender edit', async () => {
    const { messages, alice, bob, chatId } = await setup();
    const sent = await messages.send(chatId, alice.id, 'helo');

    await expectHttpError(messages.edit(chatId, sent.id, bob.id, 'hacked'), 403, 'NOT_MESSAGE_SENDER');
    const edited = await messages.edit(chatId, sent.id, alice.id, 'hello');
    assert.equal(edited.text, 'hello');
    assert.notEqual(edited.editedAt, null);
  });

  it('soft-deletes, is idempotent, and blocks editing afterwards', async () => {
    const { messages, alice, bob, chatId } = await setup();
    const sent = await messages.send(chatId, alice.id, 'oops');

    await expectHttpError(messages.delete(chatId, sent.id, bob.id), 403, 'NOT_MESSAGE_SENDER');
    const deleted = await messages.delete(chatId, sent.id, alice.id);
    const again = await messages.delete(chatId, sent.id, alice.id);

    assert.equal(deleted.text, null);
    assert.equal(again.deletedAt, deleted.deletedAt);
    assert.equal(deleted.seq, sent.seq);
    await expectHttpError(messages.edit(chatId, sent.id, alice.id, 'back'), 409, 'MESSAGE_DELETED');
  });
});
