import { NextResponse } from 'next/server';
import { apiFetchBuffer, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const { buffer, contentType } = await apiFetchBuffer(`/api/inventory/assets/${id}/photo`);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : 'The asset photo could not be loaded.';
    return NextResponse.json({ error: { code: 'ASSET_PHOTO_FAILED', message } }, { status });
  }
}
