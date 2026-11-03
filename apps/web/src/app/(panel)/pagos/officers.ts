import { memberName, type AgendaAssignee, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';

/** Un oficial a quien se le puede filtrar el ledger. */
export interface Officer {
  userId: string;
  name: string;
}

/**
 * A quién puede consultar quien mira el ledger, según **sus permisos** y no según su rol:
 *
 *  · `user:read` (administrador, gerente) → el equipo entero de la empresa.
 *  · `agenda:assign` sin lo anterior (supervisor) → los cobradores de **su agencia**, que es lo que la
 *    agenda ya le ofrece al asignar; `GET /agenda/assignees` aplica ese alcance en el servidor.
 *  · ninguno (cobrador) → nadie: no hay a quién elegir, y el filtro no se dibuja.
 *
 * ⚠️ Esto decide **qué se ofrece**, no qué se puede ver: el alcance real lo sigue poniendo la API. Tampoco se
 * llama a `/users` «por si acaso» — sin el permiso es un 403 en cada carga de la pantalla.
 */
export async function loadOfficers(permissions: readonly string[]): Promise<Officer[]> {
  if (permissions.includes('user:read')) {
    const res = await apiCall<Member[]>('/users', { method: 'GET', auth: true });
    return (res.body.data ?? []).map((m) => ({ userId: m.userId, name: memberName(m) }));
  }
  if (permissions.includes('agenda:assign')) {
    const res = await apiCall<AgendaAssignee[]>('/agenda/assignees', { method: 'GET', auth: true });
    return (res.body.data ?? []).map((a) => ({
      userId: a.userId,
      name: [a.firstName, a.lastName].filter(Boolean).join(' ') || '—',
    }));
  }
  return [];
}
