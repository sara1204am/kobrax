import { IsDateString, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { CasePriority, CaseStatus } from '@prisma/client';

/**
 * Los filtros globales del dashboard. **Los seis endpoints reciben exactamente esto**: un widget
 * que ignorara uno mostraría otra cosa que sus vecinos, y nadie sabría cuál de los dos miente.
 */
export class AnalyticsQueryDto {
  /** `YYYY-MM-DD`. Sin rango, cada consulta usa el suyo por defecto (los últimos 7 días). */
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() collectorId?: string;
  @IsOptional() @IsEnum(CaseStatus) caseStatus?: CaseStatus;
  @IsOptional() @IsEnum(CasePriority) priority?: CasePriority;
}

export class TrendQueryDto extends AnalyticsQueryDto {
  @IsOptional() @IsIn(['day', 'week', 'month']) granularity?: 'day' | 'week' | 'month';
}
