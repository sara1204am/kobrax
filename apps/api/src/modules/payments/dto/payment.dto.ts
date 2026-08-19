import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

/** Las columnas del ledger que se pueden ordenar. Son campos propios de `payments`, no de relaciones. */
export const PAYMENT_SORTS = ['paymentDate', 'amount', 'method', 'receiptNumber'] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

export class CreatePaymentDto {
  @IsUUID() creditId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsOptional() @IsUUID() caseId?: string;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() externalTransactionId?: string;
  /** Comprobante (spec §5.4). Los devuelve `POST /api/uploads`; el hash es del buffer original. */
  @IsOptional() @IsString() receiptUrl?: string;
  @IsOptional() @IsString() @Length(64, 64) receiptHash?: string;
}

export class ListPaymentsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() creditId?: string;
  @IsOptional() @IsUUID() caseId?: string;
  /** Todos los pagos de una persona, de todos sus créditos. Es el historial de la ficha. */
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;

  /**
   * Por qué columna se ordena el ledger.
   *
   * 🔴 **Lista blanca, no un campo libre.** Lo que llega acá va derecho al `orderBy` de Prisma: un
   * nombre cualquiera es un 500, y uno de una relación abre la puerta a ordenar por datos que este
   * endpoint no muestra.
   *
   * ⚠️ **`registeredBy` no está**, y no es un olvido: es un uuid de usuario (referencia suave, sin
   * relación). Ordenar por él agrupa los pagos de cada persona, sí, pero deja los grupos en un orden
   * que no es el de ningún nombre — la pantalla mostraría «Ana, Carlos, Bruno» y parecería rota. El
   * día que se necesite, se hace en dos pasos como las rutas por cobrador.
   */
  @IsOptional() @IsIn(PAYMENT_SORTS) sort?: PaymentSort;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}

export class CreatePaymentRequestDto {
  @IsOptional() @IsUUID() creditId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() caseId?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
}

export class ConfirmPaymentRequestDto {
  @IsOptional() @IsString() externalTransactionId?: string;
}
