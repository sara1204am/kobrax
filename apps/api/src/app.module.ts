import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CreditsModule } from './modules/credits/credits.module';
import { CasesModule } from './modules/cases/cases.module';
import { RoutesModule } from './modules/routes/routes.module';
import { FieldModule } from './modules/field-ops/field.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AgendaModule } from './modules/agenda/agenda.module';
import { CatalogsModule } from './modules/catalogs/catalogs.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { TenantContextModule } from './common/context/tenant-context.module';
import { AuditModule } from './common/audit/audit.module';
import { EventBusModule } from './common/events/event-bus.module';
import { RateLimitGuard } from './common/guards/rate-limit.guard';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    // TenantContext antes que Audit: el interceptor de tenant debe ser el más externo
    // para que el contexto (AsyncLocalStorage) esté activo cuando el AuditInterceptor lo lee.
    TenantContextModule,
    AuditModule,
    EventBusModule,
    HealthModule,
    AuthModule,
    ClientsModule,
    CreditsModule,
    CasesModule,
    RoutesModule,
    FieldModule,
    PaymentsModule,
    NotificationsModule,
    AgendaModule,
    CatalogsModule,
  ],
  // Rate limiting de borde para toda la API (los endpoints sensibles lo endurecen con @RateLimit).
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
