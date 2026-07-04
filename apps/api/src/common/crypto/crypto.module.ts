import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { BlindIndexService } from './blind-index.service';

/**
 * Cifrado y blind index disponibles en toda la app (`@Global`). Lo consumen el MFA
 * (F2a) y los datos sensibles de cliente (F4) sin acoplarse a `AuthModule`.
 */
@Global()
@Module({
  providers: [CryptoService, BlindIndexService],
  exports: [CryptoService, BlindIndexService],
})
export class CryptoModule {}
