import { redirect } from 'next/navigation';
import { withScope } from '../scope';

export const dynamic = 'force-dynamic';

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  redirect(withScope('/finance', query.scope));
}
