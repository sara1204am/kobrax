/**
 * La llave con la que se reconoce a una persona por su nombre: **palabras sin tildes, en mayúsculas y
 * ordenadas**. «Miriam  CRUZ apaza» y «Apaza Cruz Míriam» dan la misma llave.
 *
 * La usan la importación de cartera (`imports/client-match.ts`) y el aviso de posibles duplicados del
 * alta (`ClientsService.duplicateCheck`): si cada uno normalizara a su manera, el alta diría «nadie se
 * llama así» de alguien que el import sí habría juntado.
 */
export function nameKey(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const words = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length === 0 ? null : [...words].sort().join(' ');
}

/** Las palabras por las que conviene buscar candidatos en la base: las más largas, que menos se repiten. */
export function searchWords(fullName: string | null | undefined): string[] {
  const key = nameKey(fullName);
  if (!key) return [];
  return key
    .split(' ')
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 1);
}
