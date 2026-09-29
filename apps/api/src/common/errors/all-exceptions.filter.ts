import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { AuditValidationError } from '@nfc/db';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { getLogger } from '../logging/logger';
import { getRequestContext } from '../request-context/request-context';
import { DomainError } from './domain-error';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
    requestId: string | null;
  };
}

/** PostgreSQL error codes we translate into something a user can act on. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_RESTRICT_VIOLATION = '23001';
const PG_INSUFFICIENT_PRIVILEGE = '42501';

interface PgErrorLike {
  code?: string;
  detail?: string;
  constraint?: string;
  message: string;
}

function isPgError(error: unknown): error is PgErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/**
 * One place where every failure becomes a clean JSON response.
 *
 * Internal details never reach the client: an unexpected error returns a
 * generic message plus the request id, while the full cause goes to the logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = getRequestContext()?.requestId ?? null;
    const logger = getLogger();

    if (exception instanceof DomainError) {
      logger.warn(
        { code: exception.code, details: exception.details },
        `domain error: ${exception.message}`,
      );
      this.send(response, exception.status, {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
          requestId,
        },
      });
      return;
    }

    if (exception instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of exception.issues) {
        const key = issue.path.join('.') || '(root)';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      logger.warn({ fieldErrors }, 'request validation failed');
      this.send(response, 400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields need attention.',
          fieldErrors,
          requestId,
        },
      });
      return;
    }

    if (exception instanceof AuditValidationError) {
      logger.warn(`audit validation failed: ${exception.message}`);
      this.send(response, 400, {
        error: { code: 'REASON_REQUIRED', message: exception.message, requestId },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string }).message ?? exception.message);
      logger.warn({ status }, `http exception: ${message}`);
      this.send(response, status, {
        error: { code: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', message, requestId },
      });
      return;
    }

    if (isPgError(exception)) {
      const translated = this.translatePgError(exception);
      if (translated) {
        logger.warn(
          { pgCode: exception.code, constraint: exception.constraint },
          `database rejected the change: ${exception.message}`,
        );
        this.send(response, translated.status, {
          error: { code: translated.code, message: translated.message, requestId },
        });
        return;
      }
    }

    logger.error(
      {
        err:
          exception instanceof Error
            ? { message: exception.message, stack: exception.stack }
            : exception,
      },
      'unhandled error',
    );
    this.send(response, 500, {
      error: {
        code: 'INTERNAL_ERROR',
        message:
          'Something went wrong and the action was not completed. Quote the request id when reporting this.',
        requestId,
      },
    });
  }

  private translatePgError(
    error: PgErrorLike,
  ): { status: number; code: string; message: string } | null {
    switch (error.code) {
      case PG_UNIQUE_VIOLATION:
        return {
          status: 409,
          code: 'CONFLICT',
          message: 'That record already exists. Check the code or name and try again.',
        };
      case PG_FOREIGN_KEY_VIOLATION:
        return {
          status: 400,
          code: 'VALIDATION_FAILED',
          message: 'A referenced record does not exist.',
        };
      case PG_CHECK_VIOLATION:
        return {
          status: 400,
          code: 'VALIDATION_FAILED',
          message: error.message.replace(/^.*?ERROR:\s*/, ''),
        };
      case PG_RESTRICT_VIOLATION:
        // Raised by the append-only and no-hard-delete triggers (R2, R3).
        return {
          status: 409,
          code: 'APPEND_ONLY_VIOLATION',
          message: error.message,
        };
      case PG_INSUFFICIENT_PRIVILEGE:
        return {
          status: 403,
          code: 'FORBIDDEN',
          message: 'That operation is not permitted on this record.',
        };
      default:
        return null;
    }
  }

  private send(response: Response, status: number, body: ErrorBody): void {
    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
