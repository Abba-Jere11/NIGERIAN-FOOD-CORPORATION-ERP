import { NextResponse } from 'next/server';
import { apiFetchBuffer, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const { buffer, contentType, filename } = await apiFetchBuffer(`/api/procurement/${id}/record.pdf`);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename ?? 'record.pdf'}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : 'The record PDF could not be produced.';
    return NextResponse.json({ error: { code: 'RECORD_PDF_FAILED', message } }, { status });
  }
}
