import { getTranslations } from 'next-intl/server';
import { Permission, type AccountInfo, type ArrearCategory, type Assignee, type MeInfo, type Member, type MoraCreditListItem } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { hasMoraFilters, moraLimit, moraListQuery, type MoraParams } from '@/lib/mora';
import { EmptyState } from '@/components/panel-ui';
import { ArrearsTable } from './arrears-table';

/**
 * La cartera en mora.
 *
 * 🔴 **Abre con los vencidos, no con todo el trabajo abierto** (el piso `días >= 1` lo pone `GET /mora`). La
 * pantalla se llama Mora: listar también a quien está al día y sólo tiene el expediente sin cerrar
 * la volvía otra cosa. Ver a esos es un filtro que se saca, no el estado inicial.
 *
 * 🔴 **No hay casos que abrir ni cerrar** (F4/08): la mora es un episodio que abre y cierra el dato (el trabajo
 * diario y el trigger de la base). Nadie tiene que acordarse de apretar nada.
 *
 * 🔴 **La misma pantalla muestra cosas distintas según quién mire, y la respuesta no lo dice.**
 * `GET /mora` acota por alcance de datos: el cobrador ve lo suyo (principal, temporal o apoyo), el supervisor su
 * agencia, gerente y administrador todo. Un cobrador ve una lista corta y correcta sin ninguna señal de que está filtrada, así que
 * la señal la pone la pantalla.
 */
export default async function MoraPage({ searchParams }: { searchParams: MoraParams }) {
  const t = await getTranslations('panel.mora');
  const query = moraListQuery(searchParams);

  const [list, me, team, account, branchList] = await Promise.all([
    apiCall<MoraCreditListItem[]>(`/mora?${query}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<{ id: string; name: string }[]>('/mora/branches', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  const permissions = me.body.data?.permissions ?? [];
  // Repartir (reasignar, ayuda, reemplazo temporal) es `assignment:write`; ver todo o la agencia es alcance de datos.
  const supervises = permissions.includes(Permission.ASSIGNMENT_WRITE);
  // Cambiar la prioridad es gestionar la cobranza, no repartirla: alcanza con `collection:write`, así el
  // cobrador que conoce a su deudor puede subirla sin ser supervisor.
  const canWrite = permissions.includes(Permission.COLLECTION_WRITE);
  // Exportar es de todo rol que ve Mora: la API lo acota a su alcance (el cobrador baja sólo lo suyo).
  const canExport = permissions.includes(Permission.COLLECTION_EXPORT);
  // El equipo puede venir vacío si el rol no tiene `user:read`: el filtro por cobrador
  // simplemente no se dibuja, y la lista sigue siendo legible.
  const members = team.body.data ?? [];

  // A quién se puede asignar (no depende de `user:read`) y los rangos de categoría para el filtro. Un fallo no tumba la lista.
  const [assignees, categories] = await Promise.all([
    supervises ? apiCall<Assignee[]>('/assignments/assignees', { method: 'GET', auth: true }) : null,
    apiCall<ArrearCategory[]>('/arrear-categories', { method: 'GET', auth: true }),
  ]);
  const collectors = (assignees?.status === 200 ? (assignees.body.data ?? []) : []).map((a) => ({ userId: a.userId, name: a.name }));

  return (
    <>
      {/* Sin título: la pantalla ya se llama «Mora» en el menú, y repetirlo en 26 px empuja la tabla
          media pantalla hacia abajo. Queda la bajada, que sí dice algo que el menú no dice. */}
      <p className="mb-4 text-[14px] text-k-text-2">{t('subtitle')}</p>

      {!supervises && (
        <p className="mb-4 rounded-xl border border-k-border bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
          {t('scopedToMine')}
        </p>
      )}

      <ArrearsTable
        rows={list.body.data}
        meta={pageMeta(list.body, searchParams.page, moraLimit(searchParams))}
        members={members}
        collectors={collectors}
        categories={categories.status === 200 ? (categories.body.data ?? []) : []}
        branches={branchList.body.data ?? []}
        currency={account.body.data?.currencyCode ?? 'BOB'}
        filtered={hasMoraFilters(searchParams)}
        userId={me.body.data?.userId}
        showAssignee={supervises && (collectors.length > 0 || members.length > 0)}
        canWrite={canWrite}
        canExport={canExport}
      />
    </>
  );
}
