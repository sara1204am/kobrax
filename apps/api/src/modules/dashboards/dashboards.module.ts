import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/** Módulo de tableros (W8): la persistencia del builder. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
