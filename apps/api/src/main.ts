import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { CSRF_HEADER } from '@nfc/shared';
import { AppModule } from './app.module';
import { getRootLogger, PinoNestLogger } from './common/logging/logger';
import { loadApiEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();
  const logger = getRootLogger();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new PinoNestLogger(),
    bodyParser: true,
  });

  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Accept', 'x-request-id', CSRF_HEADER],
    exposedHeaders: ['x-request-id', 'X-Row-Count', 'X-Truncated'],
  });

  app.set('trust proxy', 'loopback');
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);

  logger.info({ url: `http://${env.API_HOST}:${env.API_PORT}` }, 'NFC Mini ERP API started');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nThe API failed to start.\n\n${message}\n`);
  process.exit(1);
});
