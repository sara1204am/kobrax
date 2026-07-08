import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Agendados de un día concreto (la pantalla principal). */
export class ListAgendaQueryDto {
  @IsDateString() date!: string; // YYYY-MM-DD
}

/** Vencidos (para la sección "máx 2 + ver más"). */
export class ListOverdueQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
