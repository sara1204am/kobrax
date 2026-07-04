import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';

/** Módulo de créditos (cronograma + mora). Guards desde AuthModule; AuditService desde AuditModule. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CreditsController],
  providers: [CreditsService],
})
export class CreditsModule {}
