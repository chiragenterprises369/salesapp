import 'reflect-metadata';
import { ConsoleLogger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import { cached, corsOriginCheck } from './common/http/cors.js';
import { AppExceptionFilter } from './common/errors/exception.filter.js';
import { getEnv } from './config/env.js';
import { DomainsService } from './modules/workspace/domains.service.js';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Raw body is required for webhook HMAC verification (req.rawBody).
    rawBody: true,
    logger: new ConsoleLogger({ json: env.NODE_ENV === 'production', prefix: 'vistar-api' }),
  });
  if (env.TRUST_PROXY) {
    const v = env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers['x-request-id'];
    req.id = typeof header === 'string' && header.length <= 64 ? header : randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });
  app.use(helmet());
  app.use(cookieParser());
  // WEB_ORIGIN, dev origins (localhost / 127.0.0.1 / *.localhost on DEV_CORS_PORTS, not in production) and
  // verified custom domains (D-060; host list cached for 60 s).
  const domains = app.get(DomainsService);
  app.enableCors({
    origin: corsOriginCheck(env, cached(() => domains.corsHosts(), 60_000)),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AppExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
}

void bootstrap();
