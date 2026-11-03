import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC keeps decorator metadata so NestJS DI works in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
    // change #19 wave C: no background hub jobs (webhook worker and sweeper, IndiaMART cron) in test apps; specs that
    // need attempts drive OutboundDispatcher.processDue() themselves, so parallel spec files cannot steal each other's deliveries.
    env: { HUB_BACKGROUND_JOBS: 'off' },
  },
});
