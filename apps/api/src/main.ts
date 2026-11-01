import 'reflect-metadata';
import { ConsoleLogger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import { AppExceptionFilter } from './common/errors/exception.filter.js';
import { getEnv } from './config/env.js';

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
  app.enableCors({
    origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
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
