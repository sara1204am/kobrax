import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextService } from './tenant-context.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

/**
 * Contexto de tenant global: expone `TenantContextService` a toda la app y registra
 * el interceptor que lo puebla por request. `@Global` → no hay que importarlo en cada módulo.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [TenantContextService],
})
export class TenantContextModule {}
