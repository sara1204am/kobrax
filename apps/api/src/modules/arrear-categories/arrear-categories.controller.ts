import { Body, Controller, Get, Put } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ArrearCategoriesService } from './arrear-categories.service';
import { ReplaceArrearCategoriesDto } from './dto/arrear-categories.dto';

@Controller('arrear-categories')
export class ArrearCategoriesController {
  constructor(private readonly categories: ArrearCategoriesService) {}

  /** Los rangos vigentes. Los lee cualquiera que vea Mora (los necesita para pintar la categoría y filtrar). */
  @Get()
  @Roles(Permission.COLLECTION_READ)
  list() {
    return this.categories.list();
  }

  /**
   * Reemplaza el juego completo. `account:write`: el permiso con el que ya se configura la cuenta (administrador).
   * Rangos inválidos → 400 `ARREAR_CATEGORIES_INVALID` con los códigos en `details.errors`.
   */
  @Put()
  @Roles(Permission.ACCOUNT_WRITE)
  replace(@Body() dto: ReplaceArrearCategoriesDto) {
    return this.categories.replace(dto);
  }
}
