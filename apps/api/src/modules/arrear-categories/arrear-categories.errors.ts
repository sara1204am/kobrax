import { BadRequestException } from '@nestjs/common';
import type { ArrearCategoryError } from '@kobrax/shared';

/** Los rangos no cumplen la regla (D1-b). `details.errors` trae los códigos de `validateArrearCategories`. */
export const arrearCategoriesInvalid = (errors: ArrearCategoryError[]) =>
  new BadRequestException({
    code: 'ARREAR_CATEGORIES_INVALID',
    message: 'Los rangos de las categorías de mora no son válidos',
    details: { errors },
  });
