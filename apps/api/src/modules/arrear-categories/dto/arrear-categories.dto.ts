import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

/**
 * Una categoría tal como la manda la pantalla. Los tipos se validan acá; **los rangos** (desde 1, sin huecos
 * ni solapes, sólo la última sin tope) los valida `validateArrearCategories` (shared) y rebotan con 400 y sus códigos.
 * `@IsNumber` y no `@IsInt` a propósito: un 1.5 tiene que salir como `RANGE_INVALID`, igual que en la pantalla.
 */
export class ArrearCategoryInputDto {
  @IsString() @MaxLength(16) code!: string;
  @IsString() @MaxLength(60) name!: string;
  @IsNumber() fromDays!: number;
  /** `null` = sin tope (sólo la última). */
  @ValidateIf((_o, v) => v !== null) @IsNumber() toDays!: number | null;
  @IsOptional() @IsString() @MaxLength(32) color?: string | null;
}

/** `PUT /arrear-categories` — el juego completo: reemplaza al anterior. */
export class ReplaceArrearCategoriesDto {
  @IsArray() @ArrayMaxSize(26) @ValidateNested({ each: true }) @Type(() => ArrearCategoryInputDto) categories!: ArrearCategoryInputDto[];
}
