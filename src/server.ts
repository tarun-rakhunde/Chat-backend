import { createApp } from './app';
import { PgChatRepository } from './chats/chat.repository';
import { ChatService } from './chats/chat.service';
import { loadConfig } from './config';
import { createFirestore } from './infra/firestore';
import { createPool } from './infra/postgres';
import { FirestoreMessageStore } from './messages/message.store';
import { MessageService } from './messages/message.service';
import { PgUserRepository } from './users/user.repository';
import { UserService } from './users/user.service';

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.DATABASE_URL);
  await pool.query('SELECT 1'); // fail fast if Postgres is unreachable
  const firestore = createFirestore(config);

  // Wiring: repositories talk to the databases, services hold the business rules.
  const userRepository = new PgUserRepository(pool);
  const chatRepository = new PgChatRepository(pool);
  const messageStore = new FirestoreMessageStore(firestore);

  const app = createApp({
    users: new UserService(userRepository),
    chats: new ChatService(chatRepository, userRepository),
    messages: new MessageService(chatRepository, messageStore),
  });

  const server = app.listen(config.PORT, (error?: Error) => {
    if (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
    const firestoreTarget = config.FIRESTORE_EMULATOR_HOST
      ? `emulator at ${config.FIRESTORE_EMULATOR_HOST}`
      : `project ${config.FIREBASE_PROJECT_ID}`;
    console.log(`Chat backend listening on http://localhost:${config.PORT} (Firestore: ${firestoreTarget})`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      void Promise.allSettled([pool.end(), firestore.terminate()]).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
