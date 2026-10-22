import { IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { PLAN_ORDER } from '@kobrax/shared';

export const REQUEST_TYPES = ['PLAN_CHANGE', 'CLOSURE'] as const;

/**
 * Un pedido de la cuenta a Kobrax. `plan` sólo importa (y es obligatorio) para cambiar de plan; `confirmName` sólo para
 * la baja. Que el plan pedido no sea el actual y que el nombre coincida lo valida el servicio, que conoce la cuenta.
 */
export class CreateAccountRequestDto {
  @IsIn([...REQUEST_TYPES]) type!: 'PLAN_CHANGE' | 'CLOSURE';
  @ValidateIf((o: CreateAccountRequestDto) => o.type === 'PLAN_CHANGE') @IsIn([...PLAN_ORDER]) plan?: string;
  @IsOptional() @IsString() @Length(1, 500) note?: string;
  @ValidateIf((o: CreateAccountRequestDto) => o.type === 'CLOSURE') @IsString() @Length(1, 160) confirmName?: string;
}
