import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { appConnection, createPool } from '@nfc/db';
import { Pool } from 'pg';
import { getRootLogger } from '../common/logging/logger';
import { APP_POOL } from './tokens';
import { UnitOfWork } from './unit-of-work';

/**
 * The API connects only as the least-privileged `nfc_app` role.
 *
 * That role is not the table owner and was created NOBYPASSRLS, so Row-Level
 * Security applies to every statement it runs. It also holds no DELETE
 * privilege on business tables, so rule R3 survives an application bug.
 */
const poolProvider = {
  provide: APP_POOL,
  useFactory: (): Pool => {
    const connection = appConnection();
    const pool = createPool({
      connectionString: connection.connectionString,
      applicationName: 'nfc-erp-api',
      max: 20,
    });
    pool.on('error', (error) => {
      getRootLogger().error({ err: { message: error.message } }, 'idle database client error');
    });
    return pool;
  },
};

@Global()
@Module({
  providers: [poolProvider, UnitOfWork],
  exports: [APP_POOL, UnitOfWork],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async onApplicationShutdown(): Promise<void> {
    await this.unitOfWork.close();
  }
}
