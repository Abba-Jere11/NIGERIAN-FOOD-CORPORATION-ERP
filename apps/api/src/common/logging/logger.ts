import { type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import { loadApiEnv } from '../../config/env';
import { getRequestContext } from '../request-context/request-context';

/**
 * Structured JSON logging.
 *
 * Production and test emit one JSON object per line. Development pipes through
 * pino-pretty for readability. Every line carries the request id, so a log line
 * and the audit entry written by the same request can be joined.
 */

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'passwordConfirmation',
  '*.password',
  'bankAccountNumber',
  'accountNumber',
];

let rootLogger: Logger | null = null;

export function getRootLogger(): Logger {
  if (rootLogger) return rootLogger;
  const env = loadApiEnv();

  const usePretty = env.NODE_ENV === 'development';

  rootLogger = pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    base: { service: 'nfc-erp-api', env: env.NODE_ENV },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(usePretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service,env' },
          },
        }
      : {}),
  });

  return rootLogger;
}

/** Logger bound to the current request, when there is one. */
export function getLogger(): Logger {
  const context = getRequestContext();
  return context?.logger ?? getRootLogger();
}

/** Adapter so NestJS framework logs also go through pino. */
export class PinoNestLogger implements LoggerService {
  private readonly logger = getRootLogger();

  log(message: unknown, ...optional: unknown[]): void {
    this.logger.info({ context: optional[0] }, String(message));
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.logger.error({ context: optional[1], trace: optional[0] }, String(message));
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.logger.warn({ context: optional[0] }, String(message));
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.logger.debug({ context: optional[0] }, String(message));
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.logger.trace({ context: optional[0] }, String(message));
  }
}
