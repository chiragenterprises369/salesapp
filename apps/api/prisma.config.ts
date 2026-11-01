import { config } from 'dotenv';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Root .env (monorepo). Run prisma commands from apps/api.
config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
