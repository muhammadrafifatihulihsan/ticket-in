import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../platform/db/schema.js';
import type { UserRepository } from '../application/ports/user.repository.port.js';
import { User } from '../domain/user.entity.js';

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase().trim()))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByUsername(username: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username.toLowerCase().trim()))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(user: User): Promise<void> {
    await this.db.insert(schema.users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  private mapToDomain(row: typeof schema.users.$inferSelect): User {
    return new User({
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.passwordHash,
      role: row.role as User['role'],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
