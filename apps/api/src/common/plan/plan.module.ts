import { Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';

/**
 * Los topes del plan. `PrismaService` y `TenantContextService` llegan por sus módulos `@Global`.
 *
 * Lo importan los módulos que **frenan** —`users` hoy; `credits`, `clients` e `imports` cuando
 * llegue su fase—. `field-ops` y `uploads` no lo importan y no van a importarlo: lo suyo avisa,
 * nunca bloquea.
 */
@Module({
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanModule {}
