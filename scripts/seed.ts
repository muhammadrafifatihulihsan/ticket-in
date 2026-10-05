import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { Argon2PasswordHasher } from '../src/modules/identity/infrastructure/argon2-password-hasher.js';
import { closeDatabase, db } from '../src/platform/db/client.js';
import * as schema from '../src/platform/db/schema.js';

interface CategorySeedConfig {
  name: string;
  price: number;
  totalSeats: number;
  prefix: string;
}

const CATEGORY_CONFIGS: CategorySeedConfig[] = [
  { name: 'VIP', price: 1500000, totalSeats: 100, prefix: 'VIP' },
  { name: 'CAT 1', price: 800000, totalSeats: 400, prefix: 'CAT1' },
  { name: 'CAT 2', price: 400000, totalSeats: 500, prefix: 'CAT2' },
];

const DEFAULT_USERS = [
  {
    email: 'admin@ticketin.internal',
    username: 'admin',
    password: 'AdminSecret123!',
    role: 'admin',
  },
  {
    email: 'organizer@ticketin.internal',
    username: 'organizer',
    password: 'OrganizerSecret123!',
    role: 'organizer',
  },
  { email: 'user1@ticketin.internal', username: 'user1', password: 'UserSecret123!', role: 'user' },
  { email: 'user2@ticketin.internal', username: 'user2', password: 'UserSecret123!', role: 'user' },
];

export async function seedDatabase(isDryRun: boolean = false): Promise<void> {
  console.info(`[Seed] Starting database seed (dry-run: ${isDryRun})...`);

  if (isDryRun) {
    console.info('[Seed] Dry-run mode enabled. Summary of data to be seeded:');
    console.info('- 4 Default Users (admin, organizer, user1, user2)');
    console.info('- 1 Concert Event: Sound of Future World Tour Jakarta 2026');
    console.info(
      '- 3 Seat Categories: VIP (100 @ Rp 1.500.000), CAT 1 (400 @ Rp 800.000), CAT 2 (500 @ Rp 400.000)',
    );
    console.info('- 1,000 Numbered Seats (VIP-001..100, CAT1-001..400, CAT2-001..500)');
    console.info('[Seed] Dry run completed successfully.');
    return;
  }

  const hasher = new Argon2PasswordHasher();

  // 1. Seed Users
  for (const u of DEFAULT_USERS) {
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, u.email))
      .limit(1);
    if (existing.length === 0) {
      const hash = await hasher.hash(u.password);
      await db.insert(schema.users).values({
        id: uuidv7(),
        email: u.email,
        username: u.username,
        passwordHash: hash,
        role: u.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.info(`[Seed] User seeded: ${u.email} (${u.role})`);
    }
  }

  // 2. Check if default event exists
  const slug = 'sound-of-future-jakarta-2026';
  const existingEvents = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.slug, slug))
    .limit(1);
  if (existingEvents.length > 0) {
    console.info(`[Seed] Event '${slug}' already exists. Skipping catalog seeding.`);
    return;
  }

  // 3. Seed Event, Categories, and 1,000 Seats in a Transaction
  await db.transaction(async (tx) => {
    const eventId = uuidv7();
    const now = new Date();
    const saleStartsAt = new Date(now.getTime() - 3600000); // 1 hour ago
    const saleEndsAt = new Date(now.getTime() + 30 * 24 * 3600000); // 30 days from now

    await tx.insert(schema.events).values({
      id: eventId,
      slug,
      title: 'Sound of Future World Tour Jakarta 2026',
      description: 'Official mega concert at Gelora Bung Karno Main Stadium Jakarta.',
      venue: 'Gelora Bung Karno Main Stadium, Jakarta',
      saleStartsAt,
      saleEndsAt,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    console.info(`[Seed] Created event: ${slug} (${eventId})`);

    const seatInserts: Array<{
      id: string;
      eventId: string;
      categoryId: string;
      seatNumber: string;
      status: string;
      version: number;
      updatedAt: Date;
    }> = [];

    for (const cat of CATEGORY_CONFIGS) {
      const categoryId = uuidv7();
      await tx.insert(schema.seatCategories).values({
        id: categoryId,
        eventId,
        name: cat.name,
        price: cat.price,
        totalSeats: cat.totalSeats,
        createdAt: now,
      });

      for (let i = 1; i <= cat.totalSeats; i++) {
        const paddedNum = String(i).padStart(3, '0');
        const seatNumber = `${cat.prefix}-${paddedNum}`;
        seatInserts.push({
          id: uuidv7(),
          eventId,
          categoryId,
          seatNumber,
          status: 'AVAILABLE',
          version: 0,
          updatedAt: now,
        });
      }
      console.info(`[Seed] Created category: ${cat.name} with ${cat.totalSeats} seats`);
    }

    // Insert seats in batches of 250
    const batchSize = 250;
    for (let i = 0; i < seatInserts.length; i += batchSize) {
      const batch = seatInserts.slice(i, i + batchSize);
      await tx.insert(schema.seats).values(batch);
    }
    console.info(`[Seed] Successfully inserted ${seatInserts.length} numbered seats.`);
  });

  console.info('[Seed] Seeding completed successfully.');
}

async function run(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  try {
    await seedDatabase(isDryRun);
  } catch (error) {
    console.error('[Seed] Error during seeding:', error);
    process.exit(1);
  } finally {
    if (!isDryRun) {
      await closeDatabase();
    }
  }
}

// Only execute when run directly from command line
if (process.argv[1]?.includes('seed.ts')) {
  void run();
}
