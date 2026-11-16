import { Router } from 'express';
import { z } from 'zod';
import { messageId, messageText, parse, uuid } from '../validation';
import type { MessageService } from './message.service';

const ChatParams = z.object({ chatId: uuid });
const MessageParams = z.object({ chatId: uuid, messageId });

const SendBody = z.object({ senderId: uuid, text: messageText });
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
});
const UserBody = z.object({ userId: uuid });
const LastSeenBody = z.object({ userId: uuid, messageId });
const EditBody = z.object({ userId: uuid, text: messageText });

export function messageRoutes(messages: MessageService): Router {
  const router = Router();

  // 2. Send Message
  router.post('/chat/:chatId/message/send', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    const { senderId, text } = parse(SendBody, req.body);
    res.status(201).json({ message: await messages.send(chatId, senderId, text) });
  });

  // 3. Get Messages — ?limit=50 (1-100), optional ?before=<seq> for older pages
  router.get('/chat/:chatId/messages', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    const { limit, before } = parse(ListQuery, req.query);
    res.json(await messages.list(chatId, { limit, beforeSeq: before }));
  });

  // 4. Mark Message Read
  router.post('/chat/:chatId/message/:messageId/read', async (req, res) => {
    const { chatId, messageId: id } = parse(MessageParams, req.params);
    const { userId } = parse(UserBody, req.body);
    res.json({ receipt: await messages.markRead(chatId, id, userId) });
  });

  // 5. Update Last Seen Message
  router.post('/chat/:chatId/lastseen', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    const { userId, messageId: id } = parse(LastSeenBody, req.body);
    res.json(await messages.updateLastSeen(chatId, userId, id));
  });

  // Read every member's last-seen pointer (e.g. to show "seen by" or unread counts).
  router.get('/chat/:chatId/lastseen', async (req, res) => {
    const { chatId } = parse(ChatParams, req.params);
    res.json({ lastSeen: await messages.listLastSeen(chatId) });
  });

  // ---- Bonus: edit / delete ----

  router.post('/chat/:chatId/message/:messageId/edit', async (req, res) => {
    const { chatId, messageId: id } = parse(MessageParams, req.params);
    const { userId, text } = parse(EditBody, req.body);
    res.json({ message: await messages.edit(chatId, id, userId, text) });
  });

  router.post('/chat/:chatId/message/:messageId/delete', async (req, res) => {
    const { chatId, messageId: id } = parse(MessageParams, req.params);
    const { userId } = parse(UserBody, req.body);
    res.json({ message: await messages.delete(chatId, id, userId) });
  });

  return router;
}
