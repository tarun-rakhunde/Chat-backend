import { Router } from 'express';
import { z } from 'zod';
import type { ChatService } from '../chats/chat.service';
import { displayName, parse, uuid } from '../validation';
import type { UserService } from './user.service';

const CreateUserBody = z.object({ name: displayName });
const UserParams = z.object({ userId: uuid });

export function userRoutes(users: UserService, chats: ChatService): Router {
  const router = Router();

  // Helper endpoint (not in the spec) so chats can be tried end to end.
  router.post('/user/create', async (req, res) => {
    const { name } = parse(CreateUserBody, req.body);
    const user = await users.create(name);
    res.status(201).json({ user });
  });

  // 6. List User Chats
  router.get('/user/:userId/chats', async (req, res) => {
    const { userId } = parse(UserParams, req.params);
    const userChats = await chats.listUserChats(userId);
    res.json({ userId, chats: userChats });
  });

  return router;
}
