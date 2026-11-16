import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ChatService } from '../src/chats/chat.service';
import { InMemoryChatRepository, InMemoryUserRepository } from './fakes';
import { expectHttpError } from './helpers';

async function setup() {
  const users = new InMemoryUserRepository();
  const service = new ChatService(new InMemoryChatRepository(), users);
  const [alice, bob, carol] = await Promise.all(['Alice', 'Bob', 'Carol'].map((name) => users.create(name)));
  if (!alice || !bob || !carol) throw new Error('setup failed');
  return { service, alice, bob, carol };
}

describe('ChatService: 1:1 chats', () => {
  it('creates a chat once and returns the same chat afterwards, in either user order', async () => {
    const { service, alice, bob } = await setup();

    const first = await service.createOrGetDirectChat(alice.id, bob.id);
    const again = await service.createOrGetDirectChat(bob.id, alice.id);

    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.chat.id, first.chat.id);
    assert.deepEqual(first.chat.members.map((m) => m.userId).sort(), [alice.id, bob.id].sort());
  });

  it('rejects a chat with yourself', async () => {
    const { service, alice } = await setup();
    await expectHttpError(service.createOrGetDirectChat(alice.id, alice.id), 400, 'SAME_USER');
  });

  it('rejects unknown users', async () => {
    const { service, alice } = await setup();
    await expectHttpError(service.createOrGetDirectChat(alice.id, randomUUID()), 404, 'USER_NOT_FOUND');
  });
});

describe('ChatService: listing', () => {
  it("lists a user's chats with their member ids", async () => {
    const { service, alice, bob, carol } = await setup();
    const direct = await service.createOrGetDirectChat(alice.id, bob.id);
    const group = await service.createGroupChat(alice.id, 'Team', [bob.id, carol.id]);

    const chats = await service.listUserChats(bob.id);

    assert.deepEqual(chats.map((c) => c.chatId).sort(), [direct.chat.id, group.id].sort());
    const listedGroup = chats.find((c) => c.chatId === group.id);
    assert.deepEqual(listedGroup?.memberIds.sort(), [alice.id, bob.id, carol.id].sort());
  });

  it('returns an empty list for a user with no chats', async () => {
    const { service, carol } = await setup();
    assert.deepEqual(await service.listUserChats(carol.id), []);
  });

  it('404s for an unknown user', async () => {
    const { service } = await setup();
    await expectHttpError(service.listUserChats(randomUUID()), 404, 'USER_NOT_FOUND');
  });
});

describe('ChatService: groups', () => {
  it('makes the creator the admin', async () => {
    const { service, alice, bob } = await setup();
    const group = await service.createGroupChat(alice.id, 'Team', [bob.id]);
    assert.equal(group.members.find((m) => m.userId === alice.id)?.role, 'admin');
    assert.equal(group.members.find((m) => m.userId === bob.id)?.role, 'member');
  });

  it('needs at least one other member', async () => {
    const { service, alice } = await setup();
    await expectHttpError(service.createGroupChat(alice.id, 'Solo', [alice.id]), 400, 'GROUP_TOO_SMALL');
  });

  it('lets only admins add members', async () => {
    const { service, alice, bob, carol } = await setup();
    const group = await service.createGroupChat(alice.id, 'Team', [bob.id]);

    await expectHttpError(service.addMembers(group.id, bob.id, [carol.id]), 403, 'ADMIN_ONLY');
    const updated = await service.addMembers(group.id, alice.id, [carol.id, bob.id]);
    assert.equal(updated.members.length, 3);
  });

  it('lets members leave but not remove others', async () => {
    const { service, alice, bob, carol } = await setup();
    const group = await service.createGroupChat(alice.id, 'Team', [bob.id, carol.id]);

    await expectHttpError(service.removeMember(group.id, bob.id, carol.id), 403, 'ADMIN_ONLY');
    const afterLeave = await service.removeMember(group.id, bob.id, bob.id);
    assert.deepEqual(afterLeave.members.map((m) => m.userId).sort(), [alice.id, carol.id].sort());
  });

  it('refuses group operations on a 1:1 chat', async () => {
    const { service, alice, bob, carol } = await setup();
    const { chat } = await service.createOrGetDirectChat(alice.id, bob.id);
    await expectHttpError(service.addMembers(chat.id, alice.id, [carol.id]), 400, 'NOT_A_GROUP');
  });

  it('renames a group (admins only)', async () => {
    const { service, alice, bob } = await setup();
    const group = await service.createGroupChat(alice.id, 'Team', [bob.id]);
    await expectHttpError(service.renameGroup(group.id, bob.id, 'Nope'), 403, 'ADMIN_ONLY');
    assert.equal((await service.renameGroup(group.id, alice.id, 'Core team')).name, 'Core team');
  });
});
