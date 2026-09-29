import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { ActorGuard } from './auth/actor.guard';
import { AuthModule } from './auth/auth.module';
import { PermissionsGuard } from './auth/permissions.guard';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OrgModule } from './org/org.module';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, OrgModule, HealthModule],
  providers: [
    // Order matters: the actor is resolved first, then the permission it needs
    // for this route is checked (rule R4).
    { provide: APP_GUARD, useClass: ActorGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
