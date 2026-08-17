import type { Prisma } from '@prisma/client';
import { searchTerms } from '@kobrax/shared';

/**
 * Buscar una persona por su nombre, como se escribe de verdad.
 *
 * 🔴 **«Teresa Mama» tiene que encontrar a «Teresa Mamani Padilla».** Buscando la frase entera no la
 * encuentra nunca: el espacio cae justo entre el nombre («Teresa») y el apellido («Mamani Padilla»),
 * así que ningún campo contiene esa cadena. Quien busca escribe el nombre y el arranque del
 * apellido — es la forma natural de escribir a alguien.
 *
 * La regla: **cada palabra tiene que aparecer en algún campo del nombre**, y pueden ser campos
 * distintos. Se devuelve un `AND` de `OR`s para que Prisma lo arme así.
 *
 * ⚠️ **No dobla acentos.** `ILIKE` de Postgres compara los bytes: «Perez» no encuentra a «Pérez».
 * Resolverlo bien es `unaccent` + un índice funcional, o sea una extensión y una migración; hoy no
 * hay ni un reclamo de eso y no se paga por adelantado.
 *
 * El documento **no entra acá**: está cifrado y se busca aparte, exacto, por blind index.
 */
export function nameTerms(q: string): Prisma.ClientWhereInput[] {
  return searchTerms(q).map((term) => ({
    OR: [
      { firstName: { contains: term, mode: 'insensitive' as const } },
      { lastName: { contains: term, mode: 'insensitive' as const } },
      { businessName: { contains: term, mode: 'insensitive' as const } },
    ],
  }));
}
