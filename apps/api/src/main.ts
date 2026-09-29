import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { DEV_ACTOR_HEADER } from './auth/actor.service';
import { getRootLogger, PinoNestLogger } from './common/logging/logger';
import { loadApiEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Environment is validated before anything else, so a misconfiguration is a
  // startup failure with a clear message rather than a runtime surprise.
  const env = loadApiEnv();
  const logger = getRootLogger();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new PinoNestLogger(),
    bodyParser: true,
  });

  app.use(
    helmet({
      contentSecurityPolicy: false, // The API serves JSON only; the web app sets its own policy.
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Accept', 'x-request-id', DEV_ACTOR_HEADER],
    exposedHeaders: ['x-request-id', 'X-Row-Count', 'X-Truncated'],
  });

  app.set('trust proxy', 'loopback');
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);

  logger.info(
    {
      url: `http://${env.API_HOST}:${env.API_PORT}`,
      devActorBridge: env.DEV_ACTOR_ENABLED ? env.DEV_ACTOR_DEFAULT : 'disabled',
    },
    'NFC Mini ERP API started',
  );
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // The logger may not exist yet if configuration itself failed.
  console.error(`\nThe API failed to start.\n\n${message}\n`);
  process.exit(1);
});
