import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import { Public } from '../auth/public.decorator';
import { APP_POOL } from '../database/database.module';
import { loadApiEnv } from '../config/env';

/**
 * Liveness and readiness. The only public endpoint in the system: it reports
 * whether the process is up and the database reachable, and nothing else.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Get()
  @Public()
  async check() {
    const startedAt = Date.now();
    let database: 'up' | 'down' = 'down';
    let databaseError: string | null = null;

    try {
      await this.pool.query('SELECT 1');
      database = 'up';
    } catch (error) {
      databaseError = error instanceof Error ? error.message : String(error);
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      environment: loadApiEnv().NODE_ENV,
      checks: {
        database,
        ...(databaseError ? { databaseError } : {}),
        databaseLatencyMs: Date.now() - startedAt,
      },
      time: new Date().toISOString(),
    };
  }
}
