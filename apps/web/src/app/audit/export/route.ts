import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchCsv, ApiError } from '@/lib/api';

/**
 * Streams the audit export to the browser.
 *
 * The API does the work: it applies the same scope rules as the viewer, caps the
 * row count, and records the export itself as a `download` entry in the log, so
 * taking data out of the system is as traceable as putting it in. This handler
 * exists only because a plain link from the browser cannot carry the acting
 * identity, which is decided on the server.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  delete query.page;
  delete query.pageSize;

  try {
    const { csv, rowCount, truncated } = await apiFetchCsv('/api/audit/export', query);
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="nfc-audit-log-${stamp}.csv"`,
        'X-Row-Count': String(rowCount),
        'X-Truncated': String(truncated),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message =
      error instanceof ApiError ? error.message : 'The export could not be produced.';
    return NextResponse.json({ error: { code: 'EXPORT_FAILED', message } }, { status });
  }
}
