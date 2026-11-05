import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { loadApiEnv } from '../config/env';

export interface StorageDriver {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

@Injectable()
export class MinioStorageDriver implements StorageDriver, OnModuleInit {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const env = loadApiEnv();
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} was empty.`);
    return Buffer.from(bytes);
  }

  /** Test helper: raw ciphertext as stored, without going through the app decrypt path. */
  async getRaw(key: string): Promise<Buffer> {
    return this.get(key);
  }
}

export const STORAGE_DRIVER = 'STORAGE_DRIVER';
