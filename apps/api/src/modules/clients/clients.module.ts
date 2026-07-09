import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientImportController } from './import/client-import.controller';
import { ClientImportService } from './import/client-import.service';

/**
 * Módulo de clientes (CU-02) + importación masiva (Fase 5). Guards desde AuthModule;
 * AuditService desde AuditModule; CryptoService/BlindIndexService/TenantContextService desde sus módulos `@Global`.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ClientsController, ClientImportController],
  providers: [ClientsService, ClientImportService],
  exports: [ClientsService], // AgendaModule lo usa para revelar PII con auditoría al agendar.
})
export class ClientsModule {}
