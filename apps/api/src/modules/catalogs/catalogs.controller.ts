import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CatalogType } from '@prisma/client';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CatalogsService } from './catalogs.service';
import { CreateCatalogItemDto, UpdateCatalogItemDto } from './dto/catalog.dto';

@Controller('catalogs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CatalogsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get(':catalog')
  @Roles(Permission.CATALOG_READ)
  list(@Param('catalog', new ParseEnumPipe(CatalogType)) catalog: CatalogType) {
    return this.catalogs.list(catalog);
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
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCatalogItemDto) {
    return this.catalogs.update(id, dto);
  }

  @Delete(':catalog/:id')
  @Roles(Permission.CATALOG_WRITE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogs.remove(id);
  }
}
