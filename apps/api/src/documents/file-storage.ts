import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { findRepositoryRoot } from '@nfc/db';
import type { StorageDriver } from './storage';

/** Encrypted blobs on disk when MinIO is not running. Still unreadable without the KEK. */
export class FileStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor() {
    this.root = join(findRepositoryRoot(), 'data', 'documents');
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(join(this.root, key));
  }
}
