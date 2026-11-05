import { cookies } from 'next/headers';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@nfc/shared';
import type { ApiErrorBody } from '@nfc/shared';

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

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
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

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((entry) => `${entry.name}=${entry.value}`)
    .join('; ');
}

export async function applyApiSetCookies(response: Response): Promise<void> {
  const store = await cookies();
  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (eq < 0 || !pair) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const attrMap = new Map(
      attrs.map((part) => {
        const [rawKey, ...rest] = part.trim().split('=');
        return [(rawKey ?? '').toLowerCase(), rest.join('=')] as const;
      }),
    );
    const httpOnly = attrs.some((part) => part.trim().toLowerCase() === 'httponly');
    const maxAgeRaw = attrMap.get('max-age');
    store.set(name, value, {
      httpOnly,
      sameSite: 'lax',
      path: attrMap.get('path') || '/',
      secure: process.env.NODE_ENV === 'production',
      ...(maxAgeRaw ? { maxAge: Number.parseInt(maxAgeRaw, 10) } : {}),
    });
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const store = await cookies();
  const csrf = store.get(CSRF_COOKIE)?.value;
  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers: {
      Accept: 'application/json',
      Cookie: await cookieHeader(),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf && method !== 'GET' ? { [CSRF_HEADER]: csrf } : {}),
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

  await applyApiSetCookies(response);

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

export async function apiFetchForm<T>(path: string, formData: FormData): Promise<T> {
  const store = await cookies();
  const csrf = store.get(CSRF_COOKIE)?.value;
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Cookie: await cookieHeader(),
      ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
    },
    body: formData,
    cache: 'no-store',
  }).catch((error: unknown) => {
    throw new ApiError(
      503,
      'API_UNREACHABLE',
      `The API at ${API_BASE} could not be reached. Is it running? (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  });
  await applyApiSetCookies(response);
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
  return (await response.json()) as T;
}

export function apiUrl(path: string): string {
  return buildUrl(path);
}

export async function apiFetchBuffer(
  path: string,
): Promise<{ buffer: ArrayBuffer; contentType: string; filename: string | null }> {
  const response = await fetch(buildUrl(path), {
    headers: { Cookie: await cookieHeader() },
    cache: 'no-store',
  });
  await applyApiSetCookies(response);
  if (!response.ok) {
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'The file could not be downloaded.');
  }
  const disposition = response.headers.get('Content-Disposition');
  const filenameMatch = disposition?.match(/filename="([^"]+)"/);
  return {
    buffer: await response.arrayBuffer(),
    contentType: response.headers.get('Content-Type') ?? 'application/octet-stream',
    filename: filenameMatch?.[1] ?? null,
  };
}

export async function apiFetchCsv(
  path: string,
  query?: RequestOptions['query'],
): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  const response = await fetch(buildUrl(path, query), {
    headers: { Accept: 'text/csv', Cookie: await cookieHeader() },
    cache: 'no-store',
  });
  await applyApiSetCookies(response);
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'The export could not be produced.');
  }
  return {
    csv: await response.text(),
    rowCount: Number.parseInt(response.headers.get('X-Row-Count') ?? '0', 10),
    truncated: response.headers.get('X-Truncated') === 'true',
  };
}

export async function hasSessionCookie(): Promise<boolean> {
  const store = await cookies();
  return Boolean(store.get(SESSION_COOKIE)?.value);
}
