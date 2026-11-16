import type { User, UserRepository } from './user.types';

export class UserService {
  constructor(private readonly users: UserRepository) {}

  create(name: string): Promise<User> {
    return this.users.create(name);
  }
}
