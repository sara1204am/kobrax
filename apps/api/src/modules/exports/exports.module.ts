import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * `PrismaService`/`TenantContextService`/`CryptoService` llegan por sus módulos `@Global`;
 * `AuditService` no lo es, y los guards ya son globales (`AuthModule`, F14 · F3);
 * el módulo sólo importa lo que sus servicios inyectan, igual que en `clients.module.ts`.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
