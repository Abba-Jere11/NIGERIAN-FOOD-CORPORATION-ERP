import { NextResponse } from 'next/server';
import { apiFetchBuffer, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const { buffer, contentType, filename } = await apiFetchBuffer(`/api/procurement/${id}/memo.pdf`);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename ?? 'memo.pdf'}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : 'The memo PDF could not be produced.';
    return NextResponse.json({ error: { code: 'MEMO_PDF_FAILED', message } }, { status });
  }
}
