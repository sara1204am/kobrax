import { Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';
import { PlanToolsService } from './plan-tools.service';

/**
 * Los topes del plan. `PrismaService` y `TenantContextService` llegan por sus módulos `@Global`.
 *
 * Lo importan los módulos que **frenan** —`users`, `credits`, `clients`, `imports`— y, desde L2,
 * `field-ops`: éste sólo para **contar y avisar** (`MonthlyCounter` + `PlanUsageAlertsService`,
 * que se provee allá). Lo suyo avisa, nunca bloquea — `assertRoom` no acepta un tope mensual.
 */
@Module({
  // `PlanToolsService` no lo inyecta ningún módulo: lo levanta `plan-cli.ts` (L3), la palanca
  // de operación por consola.
  providers: [PlanLimitsService, PlanToolsService],
  exports: [PlanLimitsService, PlanToolsService],
})
export class PlanModule {}
