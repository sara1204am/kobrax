import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalSelfService } from './legal-self.service';
import { LegalService } from './legal.service';

/** Documentos legales versionados y evidencia de aceptación y consentimiento. Prisma desde su módulo `@Global`. */
@Module({
  controllers: [LegalController],
  providers: [LegalService, LegalSelfService],
  exports: [LegalService],
})
export class LegalModule {}
