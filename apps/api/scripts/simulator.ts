/**
 * Live event simulator. OWNER: orchestrator (extended in Wave 3).
 * Run: pnpm simulate   (requires REDIS_URL and a seeded DB)
 *
 * STEP 0: publishes realistic DomainEvents for the seed workspace on the Redis event bus
 *   (channel vistar:events), using createEventSimulator() from @vistar/shared/fixtures.
 *   The API realtime gateway fans them out to sockets, so dashboard and Team Floor animate.
 * TODO (Wave 3): persist rows (leads, calls, messages) before publishing so REST and realtime agree.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { EVENT_BUS_CHANNEL, type UserSummary } from '@vistar/shared';
import { createEventSimulator, SEED_WORKSPACE } from '@vistar/shared/fixtures';
import { config } from 'dotenv';
import { Redis } from 'ioredis';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';

config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const TICK_MS = Number(process.env.SIM_TICK_MS ?? 1500);

async function main() {
  const { DATABASE_URL, REDIS_URL } = process.env;
  if (!DATABASE_URL || !REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const redis = new Redis(REDIS_URL);

  const ws = await prisma.workspace.findUnique({ where: { slug: SEED_WORKSPACE.slug } });
  if (!ws) throw new Error('Seed workspace not found. Run pnpm db:seed:demo first.');
  const dbUsers = await prisma.user.findMany({ where: { workspaceId: ws.id, isActive: true }, include: { role: true } });
  const users: UserSummary[] = dbUsers.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role.kind,
    status: u.status,
    avatar: (u.avatar as UserSummary['avatar']) ?? null,
  }));

  const sim = createEventSimulator({ workspaceId: ws.id, users, seed: Date.now() % 100_000 });
  console.info(`Simulating events for "${ws.name}" every ${TICK_MS}ms. Ctrl+C to stop.`);

  const timer = setInterval(async () => {
    for (const event of sim.next()) {
      await redis.publish(EVENT_BUS_CHANNEL, JSON.stringify(event));
      console.info(`${event.occurredAt.slice(11, 19)} ${event.type}`);
    }
  }, TICK_MS);

  const stop = async () => {
    clearInterval(timer);
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
