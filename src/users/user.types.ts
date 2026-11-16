export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export interface UserRepository {
  create(name: string): Promise<User>;
  findById(userId: string): Promise<User | null>;
  /** Returns the ids from `userIds` that do not exist. */
  findMissing(userIds: string[]): Promise<string[]>;
}
