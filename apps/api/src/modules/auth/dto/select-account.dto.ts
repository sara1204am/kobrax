import { IsString, IsUUID, MinLength } from 'class-validator';

/** Paso de selección de empresa: pre-auth token + empresa elegida. */
export class SelectAccountDto {
  @IsString()
  @MinLength(1)
  preAuthToken!: string;

  @IsUUID()
  accountId!: string;
}
