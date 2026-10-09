import { getTranslations } from 'next-intl/server';
import { todayISO, Permission, type AgendaAssignee, type AgendaListItem, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAgendaSummary } from '@/lib/agenda-summary';
import { dayOr, monthGrid } from '@/lib/agenda';
import { EmptyState } from '@/components/panel-ui';
import { AgendaConnector } from './agenda-connector';

/** Cuántas vencidas se traen. `meta.total` dice cuántas hay de verdad. */
const OVERDUE_LIMIT = 50;

/**
 * Lo agendado.
 *
 * 🔴 **Dos pedidos de agenda y no uno**, y cada uno contesta una pregunta distinta: el día que se
 * está mirando y el mes (con las semanas que completan la grilla), que pinta los puntos del mini
 * calendario y es la vista Mes. Las vencidas son un tercero, aparte.
 *
 * 🔴 **`GET /agenda` sigue sin filtrar por persona**: con `agenda:assign` devuelve el día de todo el
 * equipo, mezclado. El día no está paginado —llega entero—, así que agrupar y filtrar del lado del
 * navegador es correcto y no esconde nada.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { date?: string; view?: string; gestor?: string; tipo?: string; estado?: string };
}) {
  const t = await getTranslations('panel.agenda');
  // «Hoy» es el día de la EMPRESA que dice el servidor, no el UTC de este proceso (en Bolivia, desde las 20:00, UTC ya es mañana).
  const today = (await getAgendaSummary())?.date ?? todayISO();
  const day = dayOr(today, searchParams.date);
  const mes = monthGrid(day);

  const [list, month, overdue, me, team] = await Promise.all([
    apiCall<AgendaListItem[]>(`/agenda?date=${day}`, { method: 'GET', auth: true }),
    apiCall<AgendaListItem[]>(`/agenda?from=${mes[0]}&to=${mes[mes.length - 1]}`, { method: 'GET', auth: true }),
    apiCall<AgendaListItem[]>(`/agenda/overdue?limit=${OVERDUE_LIMIT}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    // Cobradores y supervisores de su alcance, sin pedir `user:read` (el supervisor no lo tiene): sirve para agrupar
    // el equipo y para elegir a quién asignar. Sin `agenda:assign` vuelve 403 y queda vacío.
    apiCall<AgendaAssignee[]>('/agenda/assignees', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  /*
   * El equipo puede venir vacío: `GET /users` da 403 sin `user:read`, que es justo lo que le pasa a
   * una supervisora. Sin nombres no se agrupa —dibujaría un uuid como título de cada grupo— y la
   * lista sale entera, que dice menos pero no dice nada falso.
   */
  // La agenda y el selector ya hablan de `Member`; el correo va vacío a propósito: nunca sale de la API.
  const members: Member[] = (team.body.data ?? []).map((a) => ({
    userId: a.userId,
    email: '',
    firstName: a.firstName,
    lastName: a.lastName,
    phone: null,
    photoUrl: null,
    roleId: '',
    roleName: a.roleName,
    isOwner: false,
    isActive: true,
    userStatus: 'ACTIVE',
  }));
  const canAssign = me.body.data?.permissions?.includes(Permission.AGENDA_ASSIGN) ?? false;
  const supervises = canAssign && members.length > 0;

  return (
    <AgendaConnector
      day={day}
      today={today}
      items={list.body.data}
      monthItems={month.body.data ?? []}
      overdue={overdue.body.data ?? []}
      overdueTotal={overdue.body.meta?.total ?? overdue.body.data?.length ?? 0}
      members={members}
      supervises={supervises}
      assign={canAssign && me.body.data ? { meId: me.body.data.userId } : undefined}
    />
  );
}
