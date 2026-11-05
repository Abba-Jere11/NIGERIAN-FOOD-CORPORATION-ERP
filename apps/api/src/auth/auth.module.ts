import { Global, Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AdminController } from './admin.controller';
import { AdminOpsService } from './admin-ops.service';
import { AdminUsersService } from './admin-users.service';
import { ActorService } from './actor.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EntityDirectory } from './entity-directory.service';
import { MeController } from './me.controller';

@Global()
@Module({
  imports: [WorkflowsModule],
  controllers: [AuthController, MeController, AdminController],
  providers: [ActorService, AuthService, EntityDirectory, AdminUsersService, AdminOpsService],
  exports: [ActorService, AuthService, EntityDirectory, AdminUsersService, AdminOpsService],
})
export class AuthModule {}
