import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Auditoría transversal: expone `AuditService` y registra el `AuditInterceptor` global.
 * `PrismaService` y `TenantContextService` llegan por sus módulos `@Global`.
 */
@Module({
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
