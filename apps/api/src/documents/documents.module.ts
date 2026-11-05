import { Module } from '@nestjs/common';
import { loadApiEnv } from '../config/env';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FileStorageDriver } from './file-storage';
import { MALWARE_SCANNER, NoopMalwareScanner } from './malware';
import { MinioStorageDriver, STORAGE_DRIVER } from './storage';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    {
      provide: STORAGE_DRIVER,
      useFactory: () =>
        loadApiEnv().DOCUMENT_STORAGE === 'fs' ? new FileStorageDriver() : new MinioStorageDriver(),
    },
    { provide: MALWARE_SCANNER, useClass: NoopMalwareScanner },
  ],
  exports: [DocumentsService, STORAGE_DRIVER],
})
export class DocumentsModule {}
