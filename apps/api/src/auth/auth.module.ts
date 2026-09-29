import { Global, Module } from '@nestjs/common';
import { ActorController } from './actor.controller';
import { ActorService } from './actor.service';
import { EntityDirectory } from './entity-directory.service';

@Global()
@Module({
  controllers: [ActorController],
  providers: [ActorService, EntityDirectory],
  exports: [ActorService, EntityDirectory],
})
export class AuthModule {}
