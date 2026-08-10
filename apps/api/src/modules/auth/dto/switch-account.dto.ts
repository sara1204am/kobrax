import { IsUUID } from 'class-validator';

/**
 * Cambio de empresa con la sesión ya iniciada. A diferencia de `SelectAccountDto`, acá no
 * viaja ningún pre-auth token: la identidad la pone el Bearer.
 */
export class SwitchAccountDto {
  @IsUUID()
  accountId!: string;
}
