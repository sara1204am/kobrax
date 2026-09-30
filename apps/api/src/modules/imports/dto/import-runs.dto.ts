import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IMPORT_RUN_ITEM_ACTIONS, type ImportRunItemAction } from '@kobrax/shared';

export class ListImportRunsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ListImportRunItemsQueryDto extends ListImportRunsQueryDto {
  /** Sólo los movimientos de un tipo: las nuevas, las ausentes, las rechazadas… */
  @IsOptional() @IsIn(IMPORT_RUN_ITEM_ACTIONS as unknown as string[]) action?: ImportRunItemAction;
}
