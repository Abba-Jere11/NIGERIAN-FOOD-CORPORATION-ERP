import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { ActorGuard } from './auth/actor.guard';
import { AuthModule } from './auth/auth.module';
import { PermissionsGuard } from './auth/permissions.guard';
import { CsrfGuard } from './auth/csrf.guard';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { EnginesModule } from './engines/engines.module';
import { HealthModule } from './health/health.module';
import { OrgModule } from './org/org.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { VendorsModule } from './vendors/vendors.module';
import { FinanceModule } from './finance/finance.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProcurementModule } from './procurement/procurement.module';
import { CasesModule } from './cases/cases.module';
import { EdmsModule } from './edms/edms.module';
import { OrgReportsModule } from './org-reports/org-reports.module';
import { HrModule } from './hr/hr.module';
import { MeModule } from './me/me.module';
import { PayrollModule } from './payroll/payroll.module';
import { HomeModule } from './home/home.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    AuthModule,
    AuditModule,
    OrgModule,
    HealthModule,
    EnginesModule,
    DocumentsModule,
    WorkflowsModule,
    VendorsModule,
    ProcurementModule,
    FinanceModule,
    InventoryModule,
    CasesModule,
    EdmsModule,
    OrgReportsModule,
    HrModule,
    MeModule,
    PayrollModule,
    HomeModule,
  ],
  providers: [
    // Order matters: the actor is resolved first, then the permission it needs
    // for this route is checked (rule R4).
    { provide: APP_GUARD, useClass: CsrfGuard },
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
