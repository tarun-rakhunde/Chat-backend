import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'is required'),
  FIREBASE_PROJECT_ID: z.string().min(1, 'is required'),
  // When set, firebase-admin talks to the local emulator instead of Google Cloud.
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

/** Loads `.env` (if present) into process.env, then validates it once at startup. */
export function loadConfig(): Config {
  try {
    process.loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration (see .env.example):\n${problems}`);
  }
  return parsed.data;
}
