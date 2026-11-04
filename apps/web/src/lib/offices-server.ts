import { apiCall } from './bff';
import { isMultiOffice, officeOptions, type OfficeOption, type OfficeRow } from './offices';

/**
 * Las oficinas que ve esta persona, para los server components que arman un selector (Cartera, Dashboard, Equipo, Mora,
 * Importación). La API ya recorta la lista a su alcance.
 *
 * 🔴 **Nunca tumba la pantalla.** Un rol sin `office:read` recibe 403 y la pantalla sigue abriendo, sin selector. Y con una
 * sola oficina vigente no devuelve nada: ni selector ni columna (RULES C2).
 */
export async function getOffices(): Promise<{ rows: OfficeRow[]; multi: boolean; options: OfficeOption[] }> {
  const res = await apiCall<OfficeRow[]>('/branches', { method: 'GET', auth: true });
  const rows = res.status === 200 && res.body.data ? res.body.data : [];
  const multi = isMultiOffice(rows);
  return { rows, multi, options: multi ? officeOptions(rows) : [] };
}
