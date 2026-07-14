import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

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
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
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
