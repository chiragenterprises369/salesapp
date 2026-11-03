import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { cached, corsOriginCheck } from './common/http/cors.js';
import { AppExceptionFilter } from './common/errors/exception.filter.js';
import { getEnv } from './config/env.js';
import { DomainsService } from './modules/workspace/domains.service.js';
// ---- change #20: prod
import { KvStore } from './modules/auth/state/kv.store.js';
import { installProcessErrorHooks } from './infra/prod/error-reporter.js';
import { requestLogging } from './infra/prod/http-middleware.js';
import { VistarLogger } from './infra/prod/logger.js';
import { assertProductionConfig } from './infra/prod/production-config.js';
import { getProdEnv } from './infra/prod/prod-env.js';
import { ipRateLimit } from './infra/prod/rate-limit.js';
import { apiHelmetOptions } from './infra/prod/security.js';
import { installGracefulShutdown } from './infra/prod/shutdown.js';
// ---- end change #20: prod

async function bootstrap(): Promise<void> {
  const env = getEnv();
  // ---- change #20: prod (strict production boot, JSON logs with redaction, error monitoring)
  assertProductionConfig(env);
  const prod = getProdEnv();
  const logger = new VistarLogger({ json: (prod.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json', level: prod.LOG_LEVEL, app: 'vistar-api' });
  installProcessErrorHooks();
  // ---- end change #20: prod
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Raw body is required for webhook HMAC verification (req.rawBody).
    rawBody: true,
    logger,
    bodyParser: false,
  });
  if (env.TRUST_PROXY) {
    const v = env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
  }

  // ---- change #20: prod (request ids + access log, per-IP limits, body size limits, security headers)
  app.use(requestLogging(logger));
  app.use(ipRateLimit(app.get(KvStore, { strict: false })));
  app.useBodyParser('json', { limit: prod.BODY_LIMIT_JSON });
  app.useBodyParser('urlencoded', { limit: prod.BODY_LIMIT_JSON, extended: true });
  app.use(helmet(apiHelmetOptions(env)));
  // ---- end change #20: prod
  app.use(cookieParser());
  // WEB_ORIGIN, dev origins (localhost / 127.0.0.1 / *.localhost on DEV_CORS_PORTS, not in production) and
  // verified custom domains (D-060; host list cached for 60 s).
  const domains = app.get(DomainsService);
  app.enableCors({
    origin: corsOriginCheck(env, cached(() => domains.corsHosts(), 60_000)),
    credentials: true,
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AppExceptionFilter());
  // ---- change #20: prod (drain on SIGTERM instead of enableShutdownHooks; keep-alive below the proxy's)
  installGracefulShutdown(app, logger);
  const server = app.getHttpServer() as import('node:http').Server;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;
  // ---- end change #20: prod

  await app.listen(env.API_PORT);
}

void bootstrap();
