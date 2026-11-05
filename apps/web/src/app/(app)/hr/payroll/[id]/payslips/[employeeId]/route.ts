import { NextResponse } from 'next/server';
import { apiFetchBuffer, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; employeeId: string }> },
): Promise<NextResponse> {
  const { id, employeeId } = await params;
  try {
    const { buffer, contentType, filename } = await apiFetchBuffer(
      `/api/payroll/runs/${id}/payslips/${employeeId}`,
    );
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename ?? 'payslip.pdf'}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : 'The payslip could not be downloaded.';
    return NextResponse.json({ error: { code: 'PAYSLIP_FAILED', message } }, { status });
  }
}
