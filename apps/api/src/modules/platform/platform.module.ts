import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformController } from './platform.controller';
import { SupportAccessController } from './support-access.controller';
import { SupportSessionsService } from './support-sessions.service';

/** F14 · F5 (ADR-F14-08): la plataforma — login de la persona única, sesiones de soporte y su consentimiento. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PlatformAuthController, PlatformController, SupportAccessController],
  providers: [PlatformAuthService, SupportSessionsService],
})
export class PlatformModule {}
