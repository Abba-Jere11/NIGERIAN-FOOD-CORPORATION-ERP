import type { ApiErrorBody } from '@nfc/shared';
import { getSelectedActorKey } from './actor';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string[]>;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: Record<string, string[]> = {},
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.requestId = requestId;
  }

  /** True when the caller's role or scope refuses the action (rule R4). */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Server components read fresh data; this is administrative, not cacheable. */
  cache?: RequestCache;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE.replace(/\/$/, '')}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Calls the API from a server component or server action, forwarding the acting
 * identity. Never called from the browser: the actor header is decided on the
 * server so it cannot be spoofed from a client bundle.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const actorKey = await getSelectedActorKey();

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'x-dev-actor': actorKey,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    cache: options.cache ?? 'no-store',
  }).catch((error: unknown) => {
    throw new ApiError(
      503,
      'API_UNREACHABLE',
      `The API at ${API_BASE} could not be reached. Is it running? (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  });

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    throw new ApiError(
      response.status,
      body?.error.code ?? 'HTTP_ERROR',
      body?.error.message ?? `The request failed with status ${response.status}.`,
      body?.error.fieldErrors ?? {},
      body?.error.requestId ?? response.headers.get('x-request-id'),
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Fetches a CSV export, returning the raw text and row count. */
export async function apiFetchCsv(
  path: string,
  query?: RequestOptions['query'],
): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  const actorKey = await getSelectedActorKey();
  const response = await fetch(buildUrl(path, query), {
    headers: { Accept: 'text/csv', 'x-dev-actor': actorKey },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'The export could not be produced.');
  }

  return {
    csv: await response.text(),
    rowCount: Number.parseInt(response.headers.get('X-Row-Count') ?? '0', 10),
    truncated: response.headers.get('X-Truncated') === 'true',
  };
}
