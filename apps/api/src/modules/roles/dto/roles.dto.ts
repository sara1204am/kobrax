import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

/** `GET /roles`: sin parámetros, los roles que quien pregunta puede asignar (contrato histórico de web y móvil). */
export class ListRolesQuery {
  @IsOptional()
  @Transform(({ value }) => (value === 'false' || value === false ? false : value === 'true' || value === true ? true : value))
  @IsBoolean()
  assignable?: boolean;
}

export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  permissions!: string[];

  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class RestoreRoleTemplateDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CompareRolesQuery {
  @IsString()
  @Length(1, 64)
  a!: string;

  @IsString()
  @Length(1, 64)
  b!: string;
}

export class RoleHistoryQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
