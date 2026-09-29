import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRootLogger } from '../logging/logger';
import { runWithRequestContext, type RequestContext } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Opens a request context for every request and closes the log line when the
 * response finishes. The request id is echoed back so a user reporting a
 * problem can quote it and it can be found in both the logs and the audit log.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && incoming.trim() !== '' ? incoming.trim() : randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);

    const context: RequestContext = {
      requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      sessionId: null,
      method: req.method,
      path: req.originalUrl,
      startedAt: Date.now(),
      logger: getRootLogger().child({ requestId }),
      actor: null,
    };

    res.on('finish', () => {
      const durationMs = Date.now() - context.startedAt;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      context.logger[level](
        {
          method: context.method,
          path: context.path,
          status: res.statusCode,
          durationMs,
          actor: context.actor?.ref ?? null,
          actorRole: context.actor?.role ?? null,
        },
        'request completed',
      );
    });

    runWithRequestContext(context, () => next());
  }
}
