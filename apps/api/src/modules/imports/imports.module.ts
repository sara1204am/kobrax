import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PortfolioImportController } from './portfolio-import.controller';
import { PortfolioImportService } from './portfolio-import.service';

/**
 * F10 · Import de CARTERA (créditos). Backend nuevo: el motor de reconcile de clientes
 * no sirve (solo escribe clients y borra ausentes). Guards desde AuthModule; AuditService
 * desde AuditModule; PrismaService/TenantContextService desde sus módulos @Global.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PortfolioImportController],
  providers: [PortfolioImportService],
})
export class ImportsModule {}
