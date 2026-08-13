/**
 * ¿Ese id que llegó por la URL es un uuid?
 *
 * 🔴 Los ids de la URL **entran a la ruta y a la query de la API**. Sin mirarlos, un
 * `creditId=../../users` hace que el BFF pida otro endpoint **con el Bearer de quien mira**: la
 * normalización de la URL se come el `..` antes de que la API vea nada.
 *
 * Vive suelto porque lo usan tres: el rastro de navegación (para no rotular un id), pagos y el
 * dashboard. Eran dos copias del mismo regex; el tercer consumidor es el que justificó el archivo.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
