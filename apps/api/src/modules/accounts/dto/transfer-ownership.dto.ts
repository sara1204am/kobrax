import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/** A quién se le pasa la cuenta, con la contraseña del dueño actual y —si tiene verificación en dos pasos— su código. */
export class TransferOwnershipDto {
  @IsUUID() userId!: string;
  @IsString() @Length(1, 200) password!: string;
  @IsOptional() @IsString() @Length(4, 20) code?: string;
}
