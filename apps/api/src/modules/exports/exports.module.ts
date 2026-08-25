import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * `PrismaService`/`TenantContextService`/`CryptoService` llegan por sus módulos `@Global`;
 * `AuditService` no lo es, y `JwtAuthGuard`/`RolesGuard` (los guards del controller) tampoco —
 * los trae `AuthModule`, igual que en `clients.module.ts`.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
