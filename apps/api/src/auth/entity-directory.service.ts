import { Inject, Injectable } from '@nestjs/common';
import type { EntityType, RecordStatus } from '@nfc/shared';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/tokens';

export interface DirectoryEntity {
  id: string;
  code: string;
  name: string;
  type: EntityType;
  status: RecordStatus;
}

/**
 * Resolves entity codes to identifiers so an actor's scope can be built.
 *
 * This runs before Row-Level Security applies, because the scope it produces is
 * what RLS will then enforce. It reads through the narrow SECURITY DEFINER
 * function `app.entity_directory()`, which exposes identifiers and codes and
 * nothing else.
 */
@Injectable()
export class EntityDirectory {
  private cache: DirectoryEntity[] | null = null;

  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async all(): Promise<DirectoryEntity[]> {
    if (this.cache) return this.cache;
    const result = await this.pool.query<DirectoryEntity>(
      'SELECT id, code, name, type, status FROM app.entity_directory()',
    );
    const entities = result.rows;
    this.cache = entities;
    return entities;
  }

  async byCode(code: string): Promise<DirectoryEntity | undefined> {
    const all = await this.all();
    return all.find((entity) => entity.code === code);
  }

  async byId(id: string): Promise<DirectoryEntity | undefined> {
    const all = await this.all();
    return all.find((entity) => entity.id === id);
  }

  async allIds(): Promise<string[]> {
    return (await this.all()).map((entity) => entity.id);
  }

  /** Called after any entity is created or changed, so scopes stay current. */
  invalidate(): void {
    this.cache = null;
  }
}
