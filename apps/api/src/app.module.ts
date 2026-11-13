import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApplicationsController } from './applications/applications.controller';
import { ApplicationsService } from './applications/applications.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { IngredientsController } from './ingredients/ingredients.controller';
import { IngredientsService } from './ingredients/ingredients.service';
import { MeController } from './me/me.controller';
import { EmployeeAccessController } from './organizations/employee-access.controller';
import { EmployeeAccessService } from './organizations/employee-access.service';
import { MeService } from './me/me.service';
import { MembersController } from './members/members.controller';
import { MembersService } from './members/members.service';
import { OrganizationsController } from './organizations/organizations.controller';
import { OrganizationsService } from './organizations/organizations.service';
import { OrgContextGuard } from './permissions/org-context.guard';

@Module({
  imports: [
    // Read at app start (not import), so tests can build apps with different limits.
    ThrottlerModule.forRootAsync({
      useFactory: () => [{ ttl: 60_000, limit: env().AUTH_RATE_LIMIT_PER_MINUTE }],
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
  ],
  controllers: [
    HealthController,
    MeController,
    OrganizationsController,
    ApplicationsController,
    MembersController,
    EmployeeAccessController,
    IngredientsController,
  ],
  providers: [
    MeService,
    OrganizationsService,
    ApplicationsService,
    MembersService,
    EmployeeAccessService,
    IngredientsService,
    // Order matters: authenticate first, then resolve the organization and check permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: OrgContextGuard },
  ],
})
export class AppModule {}
