import { Global, Module } from '@nestjs/common';
import { OfficeScopeService } from './office-scope.service';

/** Servicio único de alcance por oficina (F13). `@Global`: lo usan mora, agenda, asignaciones, rutas, créditos y analítica. */
@Global()
@Module({ providers: [OfficeScopeService], exports: [OfficeScopeService] })
export class OfficeScopeModule {}
