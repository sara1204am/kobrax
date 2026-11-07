import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { FactsLoader } from './facts-loader';
import { PiiService } from './pii.service';
import { PolicyService } from './policy.service';

/** F14 · F3: autorización central. `@Global`: la usan todos los servicios de dominio. */
@Global()
@Module({
  providers: [AuthorizationService, FactsLoader, PolicyService, PiiService],
  exports: [AuthorizationService, PolicyService, FactsLoader, PiiService],
})
export class AuthzModule {}
