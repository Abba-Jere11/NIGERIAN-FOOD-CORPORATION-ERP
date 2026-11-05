import { Module, forwardRef } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PublicInvitesController } from './public-invites.controller';

@Module({
  imports: [forwardRef(() => HrModule)],
  controllers: [MeController, PublicInvitesController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
