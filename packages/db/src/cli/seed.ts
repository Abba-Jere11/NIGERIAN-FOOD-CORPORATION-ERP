import { createPool } from '../client';
import { loadRootEnv, ownerConnection } from '../env';
import { seedOrganizationStructure } from '../seed';
import { seedEngines } from '../seed-engines';
import { seedIdentity } from '../seed-identity';
import { seedM4 } from '../seed-m4';
import { seedM5 } from '../seed-m5';
import { seedM6 } from '../seed-m6';
import { seedM7 } from '../seed-m7';
import { seedM8 } from '../seed-m8';
import { seedM9 } from '../seed-m9';
import { seedM10 } from '../seed-m10';
import { seedM11 } from '../seed-m11';
import { seedM12 } from '../seed-m12';
import { seedM13 } from '../seed-m13';
import { seedM14 } from '../seed-m14';
import { seedM15 } from '../seed-m15';
import { reportFailure, targetsFromArgv } from './shared';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * Seeds the organisation structure and the seeded identities. Idempotent.
 */
async function main(): Promise<void> {
  loadRootEnv();
  const password = requiredEnv('SEED_USER_PASSWORD');
  const skipFlag = ['true', '1', 'yes'].includes(
    (process.env.SEED_E2E_SKIP_MUST_CHANGE ?? '').toLowerCase(),
  );
  const mfaKey = process.env.MFA_ENCRYPTION_KEY?.trim() || null;

  for (const target of targetsFromArgv()) {
    const connection = ownerConnection(target);
    console.log(`\n${target}: ${connection.database}`);

    const pool = createPool({
      connectionString: connection.connectionString,
      applicationName: 'nfc-erp-seed',
      max: 1,
    });

    try {
      const summary = await seedOrganizationStructure(pool);
      if (summary.alreadyPresent) {
        console.log('  Organisation structure already seeded');
      } else {
        console.log(
          `  Created ${summary.organizationsCreated} organization, ` +
            `${summary.entitiesCreated} entities, ${summary.departmentsCreated} departments`,
        );
      }

      const e2eReady = target === 'test' && skipFlag;
      if (e2eReady && !mfaKey) {
        throw new Error('SEED_E2E_SKIP_MUST_CHANGE on the test database requires MFA_ENCRYPTION_KEY.');
      }

      const identity = await seedIdentity(pool, {
        password,
        e2eReady,
        mfaEncryptionKey: mfaKey,
      });
      if (identity.alreadyPresent) {
        console.log('  Identities already seeded');
      } else {
        console.log(
          `  Seeded ${identity.usersCreated} users, ${identity.rolesCreated} roles, ${identity.permissionsCreated} permission keys` +
            (e2eReady ? ' (e2e-ready: password change skipped, TOTP fixture enrolled)' : ''),
        );
      }

      const engines = await seedEngines(pool);
      console.log(
        engines.alreadyPresent
          ? '  Engine fixtures already seeded'
          : '  Seeded search and timeline fixtures',
      );

      const m4 = await seedM4(pool);
      console.log(
        m4.alreadyPresent
          ? '  M4 workflow fixture already seeded'
          : '  Seeded milling-machine workflow fixture PR-2026-000184',
      );

      const m5 = await seedM5(pool);
      console.log(
        m5.alreadyPresent
          ? '  M5 vendor fixtures already seeded'
          : '  Seeded vendor register (XYZ Limited VND-000018)',
      );

      const m6 = await seedM6(pool);
      console.log(
        m6.alreadyPresent
          ? '  M6 procurement fixtures already seeded'
          : '  Seeded YFZ procurement draft PR-2026-000186',
      );

      const m7 = await seedM7(pool);
      console.log(
        m7.alreadyPresent
          ? '  M7 procurement approval fixtures already seeded'
          : '  Seeded M7 approval fixtures PR-2026-000187 to PR-2026-000190',
      );

      const m8 = await seedM8(pool);
      console.log(
        m8.alreadyPresent
          ? '  M8 finance fixtures already seeded'
          : '  Seeded M8 bank accounts and finance fixtures PR-2026-000191 / PR-2026-000192',
      );

      const m9 = await seedM9(pool);
      console.log(
        m9.alreadyPresent
          ? '  M9 delivery fixtures already seeded'
          : '  Seeded M9 delivery fixtures PR-2026-000193 / PR-2026-000194',
      );

      const m10 = await seedM10(pool);
      console.log(
        m10.alreadyPresent
          ? '  M10 finance fixtures already seeded'
          : '  Seeded M10 fiscal years, COA, journals and budgets',
      );

      const m11 = await seedM11(pool);
      console.log(
        m11.alreadyPresent
          ? '  M11 finance fixtures already seeded'
          : '  Seeded M11 customers, AR, IC and procurement GL backfill',
      );

      const m12 = await seedM12(pool);
      console.log(
        m12.alreadyPresent
          ? '  M12 report fixtures already seeded'
          : '  Seeded M12 saved income-statement parameter set',
      );

      const m13 = await seedM13(pool);
      console.log(
        m13.alreadyPresent
          ? '  M13 inventory fixtures already seeded'
          : '  Seeded M13 warehouses, items and GRN stock backfill',
      );

      const m14 = await seedM14(pool);
      console.log(
        m14.alreadyPresent
          ? '  M14 production and sales fixtures already seeded'
          : '  Seeded M14 overhead rules, production and sales orders',
      );

      const m15 = await seedM15(pool);
      console.log(
        m15.alreadyPresent
          ? `  M15 EDMS folders already seeded (${m15.packagesFiled} packages backfilled)`
          : `  Seeded M15 Document Portal folders and PR-2026-000195 (${m15.packagesFiled} packages filed)`,
      );
    } finally {
      await pool.end();
    }
  }
}

main().catch(reportFailure);
