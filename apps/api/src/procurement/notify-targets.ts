import type { PoolClient } from 'pg';

/**
 * Who should verify delivery: the preparer when known, otherwise anyone who
 * holds procurement.verify.delivery on the entity.
 */
export async function deliveryVerificationRecipients(
  client: PoolClient,
  opts: { entityId: string; preparedByUserId: string | null },
): Promise<string[]> {
  if (opts.preparedByUserId) return [opts.preparedByUserId];
  const holders = await client.query<{ user_id: string }>(
    `SELECT user_id FROM app.users_holding_permission($1, $2::uuid, 'ALL')`,
    ['procurement.verify.delivery', opts.entityId],
  );
  return holders.rows.map((row) => row.user_id);
}
