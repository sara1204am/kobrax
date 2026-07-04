import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

/** Módulo de rutas (RF-07). EventBus/TenantContext/Prisma desde sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RoutesController],
  providers: [RoutesService],
})
export class RoutesModule {}
