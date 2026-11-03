import type { INestApplication, LoggerService } from '@nestjs/common';
import type { Server } from 'node:http';
import { getProdEnv } from './prod-env.js';
import { ReadinessService } from './readiness.service.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Graceful shutdown (change #20), instead of Nest's enableShutdownHooks: on SIGTERM or SIGINT
 *  1. /api/ready answers 503 (draining) so Caddy and the orchestrator stop routing new requests here,
 *  2. after SHUTDOWN_DRAIN_MS the HTTP server stops accepting connections and idle keep-alive sockets close,
 *  3. app.close() runs the Nest shutdown hooks: Socket.IO server and Redis adapter, BullMQ queue and worker
 *     (the webhook worker finishes its running jobs), schedulers, event bus, Redis and Prisma,
 *  4. the process exits 0; if anything hangs past SHUTDOWN_TIMEOUT_MS it exits 1.
 * A second signal exits at once.
 */
export function installGracefulShutdown(app: INestApplication, logger: LoggerService): void {
  const env = getProdEnv();
  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) {
      logger.warn(`${signal} again: exiting now`, 'Shutdown');
      process.exit(1);
    }
    stopping = true;
    logger.log(`${signal}: draining for ${env.SHUTDOWN_DRAIN_MS} ms, then closing`, 'Shutdown');
    const hard = setTimeout(() => {
      logger.error(`Shutdown took longer than ${env.SHUTDOWN_TIMEOUT_MS} ms: exiting`, 'Shutdown');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    hard.unref();
    void (async () => {
      try {
        app.get(ReadinessService, { strict: false }).startDraining();
      } catch {
        // readiness not registered (tests)
      }
      await sleep(env.SHUTDOWN_DRAIN_MS);
      const server = app.getHttpServer() as Server;
      server.closeIdleConnections?.();
      await app.close();
      logger.log('Closed cleanly', 'Shutdown');
      process.exit(0);
    })().catch((err: Error) => {
      logger.error(`Shutdown failed: ${err.message}`, 'Shutdown');
      process.exit(1);
    });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
