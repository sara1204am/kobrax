import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextService } from './tenant-context.service';
import { TenantClockService } from './tenant-clock.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

/**
 * Contexto de tenant global: expone `TenantContextService` a toda la app y registra
 * el interceptor que lo puebla por request. `@Global` → no hay que importarlo en cada módulo.
 *
 * `TenantClockService` viaja acá porque es lo mismo mirado desde el reloj: qué día es **para este
 * tenant**. Cualquier módulo que compare contra "hoy" lo necesita, y global le ahorra el import.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    TenantClockService,
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [TenantContextService, TenantClockService],
})
export class TenantContextModule {}
