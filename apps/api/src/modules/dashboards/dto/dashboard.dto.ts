import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { WIDGET_TYPES } from '@kobrax/shared';

/**
 * Un widget que llega del panel.
 *
 * Los límites de la grilla se validan **acá y no sólo en el navegador**: un widget con `x: 999`
 * queda fuera de la pantalla y **no hay forma de volver a agarrarlo** para moverlo — el tablero se
 * rompe de una manera que la persona no puede deshacer.
 */
export class WidgetDto {
  @IsIn(WIDGET_TYPES as unknown as string[]) type!: string;
  @IsOptional() @IsString() @Length(0, 80) title?: string;
  @IsInt() @Min(0) @Max(11) x!: number;
  @IsInt() @Min(0) @Max(200) y!: number;
  @IsInt() @Min(1) @Max(12) w!: number;
  @IsInt() @Min(1) @Max(20) h!: number;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class CreateDashboardDto {
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() @Length(0, 240) description?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  /** El tope no es paranoia: 60 widgets son 60 consultas y una pantalla que nadie puede leer. */
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => WidgetDto) widgets?: WidgetDto[];
}

/**
 * El parche del tablero.
 *
 * `widgets` viaja **entero o no viaja**: al guardar el layout se manda la lista completa y el
 * servidor la reemplaza. Mandar diferencias por widget obligaría a resolver conflictos de posición
 * entre widgets que se movieron juntos, que es justo lo que un arrastre hace todo el tiempo.
 */
export class UpdateDashboardDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @Length(0, 240) description?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => WidgetDto) widgets?: WidgetDto[];
}
