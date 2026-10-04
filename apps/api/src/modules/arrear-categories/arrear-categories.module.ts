import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ArrearCategoriesController } from './arrear-categories.controller';
import { ArrearCategoriesService } from './arrear-categories.service';

/** Rangos de la categoría de mora por cuenta (F4/08 · D1-b), editables desde Administración. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ArrearCategoriesController],
  providers: [ArrearCategoriesService],
})
export class ArrearCategoriesModule {}
