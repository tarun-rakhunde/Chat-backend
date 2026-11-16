import { Router } from 'express';
import { z } from 'zod';
import { displayName, parse, uuid } from '../validation';
import type { ChatService } from './chat.service';

const CreateDirectChatBody = z.object({ userAId: uuid, userBId: uuid });
const ChatParams = z.object({ chatId: uuid });
const CreateGroupBody = z.object({
  creatorId: uuid,
  name: displayName,
  memberIds: z.array(uuid).min(1, 'must include at least one member').max(256),
});
const AddMembersBody = z.object({ actorId: uuid, userIds: z.array(uuid).min(1).max(256) });
const RemoveMemberBody = z.object({ actorId: uuid, userId: uuid });
const RenameBody = z.object({ actorId: uuid, name: displayName });

export function chatRoutes(chats: ChatService): Router {
  const router = Router();

  // 1. Create or Get Chat — 201 when created, 200 when it already existed.
  router.post('/chat/create', async (req, res) => {
    const { userAId, userBId } = parse(CreateDirectChatBody, req.body);
    const { chat, created } = await chats.createOrGetDirectChat(userAId, userBId);
    res.status(created ? 201 : 200).json({ chatId: chat.id, created });
  });

  // ---- Group chats (bonus) ----

  router.post('/chat/group/create', async (req, res) => {
    const { creatorId, name, memberIds } = parse(CreateGroupBody, req.body);
    const chat = await chats.createGroupChat(creatorId, name, memberIds);
    res.status(201).json({ chatId: chat.id, chat });
  });

  router.get('/chat/:chatId', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    res.json({ chat: await chats.getChat(chatId) });
  });

  router.post('/chat/:chatId/members/add', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    const { actorId, userIds } = parse(AddMembersBody, req.body);
    res.json({ chat: await chats.addMembers(chatId, actorId, userIds) });
  });

  router.post('/chat/:chatId/members/remove', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    const { actorId, userId } = parse(RemoveMemberBody, req.body);
    res.json({ chat: await chats.removeMember(chatId, actorId, userId) });
  });

  router.post('/chat/:chatId/rename', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    const { actorId, name } = parse(RenameBody, req.body);
    res.json({ chat: await chats.renameGroup(chatId, actorId, name) });
  });

  return router;
}
