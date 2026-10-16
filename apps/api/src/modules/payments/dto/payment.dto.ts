import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { PaymentChannel, PaymentMethod, PaymentRequestStatus } from '@prisma/client';
import { CREDIT_SOURCES, type CreditSource } from '@kobrax/shared';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Hasta cuántos valores admite un filtro de varios (oficiales, medios): más es una URL que nadie escribió. */
const MAX_LIST = 50;
const UUID_LIST = new RegExp(`^${UUID}(,${UUID}){0,${MAX_LIST - 1}}$`, 'i');
const METHODS = Object.values(PaymentMethod).join('|');
const METHOD_LIST = new RegExp(`^(${METHODS})(,(${METHODS})){0,${MAX_LIST - 1}}$`);

/** Las columnas del ledger que se pueden ordenar. Son campos propios de `payments`, no de relaciones. */
export const PAYMENT_SORTS = ['paymentDate', 'amount', 'method', 'receiptNumber'] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

export class CreatePaymentDto {
  @IsUUID() creditId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() externalTransactionId?: string;
  /** Comprobante (spec §5.4). Los devuelve `POST /api/uploads`; el hash es del buffer original. */
  @IsOptional() @IsString() receiptUrl?: string;
  @IsOptional() @IsString() @Length(64, 64) receiptHash?: string;
  /** N° del recibo o la factura en papel. Opcional; el ledger lo guarda tal cual (sin espacios de los extremos). */
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(1, 40) receiptReference?: string;
  /** Quién recibió la plata (D3). Default `KOBRAX_COLLECTED`. */
  @IsOptional() @IsEnum(PaymentChannel) channel?: PaymentChannel;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
  /**
   * Cuándo se cobró, si no es ahora: el pago guardado offline viaja con la hora del cobro. La ventana
   * (no futuro, no más viejo que `PAYMENT_BACKDATE_DAYS`) la valida el service.
   */
  @IsOptional() @IsDateString() paymentDate?: string;
  /** La visita en la que se cobró (opcional: no todo cobro sale de una visita). Debe ser de ese crédito. */
  @IsOptional() @IsUUID() visitId?: string;
}

export class ListPaymentsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() creditId?: string;
  /** Todos los pagos de una persona, de todos sus créditos. Es el historial de la ficha. */
  @IsOptional() @IsUUID() clientId?: string;
  /** Quién registró el cobro, uno o varios (ids separados por coma): lo que pide quien concilia la jornada. */
  @IsOptional() @Matches(UUID_LIST) registeredBy?: string;
  /** Medio de pago, uno o varios (`CASH,QR`). */
  @IsOptional() @Matches(METHOD_LIST) method?: string;
  /**
   * Pide además lo cobrado **hoy** y **este mes** (días civiles de la empresa), para las tarjetas del ledger. Aparte porque
   * cuesta dos sumas más y el móvil, que lista por día, no las necesita.
   */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() summary?: boolean;
  /** D7: sólo los pagos imputados a créditos de esa fuente. `KOBRAX` = sin fuente externa. */
  @IsOptional() @IsIn(CREDIT_SOURCES as unknown as string[]) source?: CreditSource;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  /**
   * Un día civil de la **empresa** (`YYYY-MM-DD`). Lo resuelve el servidor con su zona horaria: el teléfono no la conoce, y
   * armar `from/to` en UTC dejaba fuera lo cobrado después de las 20:00 en La Paz. Si viene, manda sobre `from`/`to`.
   */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) day?: string;

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

export class ListPaymentRequestsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** `PENDING` es la bandeja «por confirmar». */
  @IsOptional() @IsEnum(PaymentRequestStatus) status?: PaymentRequestStatus;
  @IsOptional() @IsUUID() creditId?: string;
  /** Quién pidió el cobro. */
  @IsOptional() @IsUUID() createdBy?: string;
}

export class CreatePaymentRequestDto {
  @IsOptional() @IsUUID() creditId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
}

export class ConfirmPaymentRequestDto {
  @IsOptional() @IsString() externalTransactionId?: string;
}
