/**
 * Domain errors carry a stable machine-readable code alongside the message, so
 * the interface can react to a specific failure rather than parsing prose.
 */
export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_RECORD'
  | 'REASON_REQUIRED'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'APPEND_ONLY_VIOLATION';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: DomainErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationFailedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_FAILED', 400, message, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('NOT_FOUND', 404, message, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', 409, message, details);
  }
}

/**
 * Raised when an optimistic-locking check fails: the caller read row_version N
 * but the row has since moved on (A7).
 */
export class StaleRecordError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('STALE_RECORD', 409, message, details);
  }
}

/** Rule R11: reject, return, archive, restore and overrides need a reason. */
export class ReasonRequiredError extends DomainError {
  constructor(action: string) {
    super(
      'REASON_REQUIRED',
      400,
      `A reason is required to ${action}. It is stored permanently and shown to everyone who reviews this record.`,
      { action },
    );
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('FORBIDDEN', 403, message, details);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message: string) {
    super('UNAUTHENTICATED', 401, message);
  }
}
