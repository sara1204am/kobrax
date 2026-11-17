import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/** Documentos legales versionados y evidencia de aceptación y consentimiento. Prisma desde su módulo `@Global`. */
@Module({
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
