import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchBuffer, ApiError } from '@/lib/api';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ kind: string }> },
): Promise<NextResponse> {
  const { kind } = await context.params;
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const search = new URLSearchParams(query).toString();
  try {
    const file = await apiFetchBuffer(`/api/finance/reports/${kind}/export${search ? `?${search}` : ''}`);
    return new NextResponse(file.buffer, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename ?? `${kind}.bin`}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : 'The export could not be produced.';
    return NextResponse.json({ error: { code: 'EXPORT_FAILED', message } }, { status });
  }
}
