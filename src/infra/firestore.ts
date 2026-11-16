import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Config } from '../config';

/**
 * Connects to Firestore.
 * - FIRESTORE_EMULATOR_HOST set  -> local emulator, no credentials needed.
 * - otherwise                    -> real project, credentials from GOOGLE_APPLICATION_CREDENTIALS.
 */
export function createFirestore(config: Config): Firestore {
  const app =
    getApps()[0] ??
    initializeApp(
      config.FIRESTORE_EMULATOR_HOST
        ? { projectId: config.FIREBASE_PROJECT_ID }
        : { projectId: config.FIREBASE_PROJECT_ID, credential: applicationDefault() },
    );

  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}
