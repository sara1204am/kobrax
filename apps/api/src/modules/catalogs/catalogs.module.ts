import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CatalogsController } from './catalogs.controller';
import { CatalogsService } from './catalogs.service';

/** Catálogos configurables por tenant (F10). Prisma/TenantContext desde sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CatalogsController],
  providers: [CatalogsService],
  exports: [CatalogsService],
})
export class CatalogsModule {}
