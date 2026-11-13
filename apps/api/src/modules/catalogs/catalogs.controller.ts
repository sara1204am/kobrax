import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CatalogType } from '@prisma/client';
import { Permission } from '@kobrax/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CatalogsService } from './catalogs.service';
import { CreateCatalogItemDto, UpdateCatalogItemDto } from './dto/catalog.dto';

@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get(':catalog')
  @Roles(Permission.CATALOG_READ)
  list(
    @Param('catalog', new ParseEnumPipe(CatalogType)) catalog: CatalogType,
    // `?includeInactive=true`: el editor de Cuenta ve también los desactivados. Sin él, sólo los activos.
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.catalogs.list(catalog, includeInactive === 'true');
  }

  @Post(':catalog')
  @Roles(Permission.CATALOG_WRITE)
  create(
    @Param('catalog', new ParseEnumPipe(CatalogType)) catalog: CatalogType,
    @Body() dto: CreateCatalogItemDto,
  ) {
    return this.catalogs.create(catalog, dto);
  }

  @Patch(':catalog/:id')
  @Roles(Permission.CATALOG_WRITE)
  update(
    @Param('catalog', new ParseEnumPipe(CatalogType)) catalog: CatalogType,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.catalogs.update(catalog, id, dto);
  }

  @Delete(':catalog/:id')
  @Roles(Permission.CATALOG_WRITE)
  remove(@Param('catalog', new ParseEnumPipe(CatalogType)) catalog: CatalogType, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalogs.remove(catalog, id);
  }
}
