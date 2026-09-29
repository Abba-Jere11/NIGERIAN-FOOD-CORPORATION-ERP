import { createPool } from '../client';
import { ownerConnection } from '../env';
import { seedOrganizationStructure } from '../seed';
import { reportFailure, targetsFromArgv } from './shared';

/**
 * Seeds the organisation structure. Idempotent: running it twice creates
 * nothing the second time and writes no duplicate audit entries.
 */
async function main(): Promise<void> {
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
        console.log('  Organisation structure already seeded, nothing to do');
      } else {
        console.log(
          `  Created ${summary.organizationsCreated} organization, ` +
            `${summary.entitiesCreated} entities, ${summary.departmentsCreated} departments`,
        );
      }
    } finally {
      await pool.end();
    }
  }
}

main().catch(reportFailure);
