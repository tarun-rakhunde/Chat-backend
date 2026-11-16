import express, { type Express } from 'express';
import { chatRoutes } from './chats/chat.routes';
import type { ChatService } from './chats/chat.service';
import { errorHandler, notFoundHandler } from './errorHandler';
import { messageRoutes } from './messages/message.routes';
import type { MessageService } from './messages/message.service';
import { userRoutes } from './users/user.routes';
import type { UserService } from './users/user.service';

export interface Services {
  users: UserService;
  chats: ChatService;
  messages: MessageService;
}

/** Builds the HTTP app from already-wired services, so it can be created with real or fake backends. */
export function createApp(services: Services): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(userRoutes(services.users, services.chats));
  app.use(chatRoutes(services.chats));
  app.use(messageRoutes(services.messages));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
