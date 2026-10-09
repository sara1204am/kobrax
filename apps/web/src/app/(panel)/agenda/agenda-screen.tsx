'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberName, type AgendaListItem, type Member } from '@kobrax/shared';
import { filterItems } from '@/lib/agenda';
import { Segmented } from '@/components/panel-ui';
import { DayPanel } from './day-panel';
import { MiniCalendar } from './mini-calendar';
import { MonthCalendar } from './month-calendar';
import { OverduePanel } from './overdue-panel';
import { WeekPanel } from './week-panel';
import { FiltersCard, SummaryCard } from './side-cards';

/**
 * Lo que la pantalla **pide** que pase. No lo hace ella.
 *
 * 🔴 Crear, ver y ejecutar una gestión son pantallas y modales que ya existen en otro lado. Si esta
 * pantalla los abriera, cada una de esas cosas tendría dos implementaciones que se van
 * separando. Acá se emite el pedido y quien la usa decide qué abrir.
 */
export interface AgendaEvents {
  onCreateRequest: (input: { date: string; time?: string; gestorId?: string }) => void;
  onViewRequest: (id: string) => void;
  onCompleteRequest: (id: string) => void;
  onRescheduleRequest: (id: string) => void;
  onCancelRequest: (id: string) => void;
  /** Solo se ofrecen cuando `item.canEdit`: editar y eliminar son de quien creó la gestión. */
  onEditRequest: (id: string) => void;
  onDeleteRequest: (id: string) => void;
}

/**
 * La agenda: **el día, y dónde está el trabajo**.
 *
 * 🔴 **El estado vive en la URL** —día, vista, cobrador, tipo y estado—, no adentro. Así la vista se comparte
 * por link, «atrás» funciona, y cambiar de Día a Mes conserva el día y los filtros: son el mismo
 * parámetro leído dos veces. Sólo el texto de la búsqueda es local: pedirle al servidor el día de nuevo por cada
 * tecla no tiene sentido.
 *
 * 🔴 **Los filtros se aplican acá y no en la API, y es correcto**: `GET /agenda` devuelve el día
 * (o el mes) entero sin paginar. Filtrar en el navegador sobre algo que ya llegó completo no esconde nada —lo
 * que sí escondería es filtrar una página de veinte y llamarla «el día».
 */
export function AgendaScreen({
  day,
  today,
  items,
  monthItems,
  overdue,
  overdueTotal,
  members,
  supervises,
  events,
}: {
  day: string;
  today: string;
  /** Las del día elegido. */
  items: AgendaListItem[];
  /** Las del mes de `day` (con las semanas que completan la grilla): puntos del mini calendario y vista Mes. */
  monthItems: AgendaListItem[];
  overdue: AgendaListItem[];
  overdueTotal: number;
  members: Member[];
  /** Con `agenda:assign` se ve el equipo: aparece el selector de equipo y el filtro por cobrador. */
  supervises: boolean;
  events: AgendaEvents;
}) {
  const t = useTranslations('panel.agenda');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState('');

  const view = params.get('view') === 'calendar' ? 'month' : params.get('view') === 'week' ? 'week' : 'day';
  const gestor = params.get('gestor') ?? '';
  const tipo = params.get('tipo') ?? '';
  const estado = params.get('estado') ?? '';

  /** Escribe en la URL sin perder lo que ya había: es lo que conserva día y filtros al cambiar de vista. */
  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next}`);
  }

  /*
   * 🔴 **La agenda abre SIEMPRE en Día.** El mes es una consulta puntual: la pantalla que se abre veinte
   * veces por día es la del trabajo de hoy. Con `?view=calendar` en la URL el mes se comparte por link.
   */

  const filters = useMemo(() => ({ gestor, tipo, estado, q }), [gestor, tipo, estado, q]);
  const visibles = useMemo(() => filterItems(items, filters), [items, filters]);
  const delMes = useMemo(() => filterItems(monthItems, filters), [monthItems, filters]);
  const conItems = useMemo(() => new Set(delMes.map((i) => i.scheduledDate.slice(0, 10))), [delMes]);
  const hayFiltro = !!(gestor || tipo || estado || q.trim());
  /*
   * 🔴 Las vencidas obedecen a los mismos filtros que el día (cobrador, tipo y búsqueda; el estado no aplica: todas
   * están pendientes). Antes el panel rojo seguía mostrando las de TODO el equipo aunque se hubiera elegido a una
   * persona. Con un filtro puesto, el total es lo filtrado de lo traído (el servidor manda las primeras páginas).
   */
  const vencidas = useMemo(() => filterItems(overdue, { gestor, tipo, q }), [overdue, gestor, tipo, q]);
  const vencidasTotal = gestor || tipo || q.trim() ? vencidas.length : overdueTotal;

  const crear = () => events.onCreateRequest({ date: day, gestorId: gestor || undefined });

  return (
    <>
      <div className="mb-5 grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight text-k-navy">{t('title')}</h1>
          <p className="mt-1 text-[14px] text-k-text-2">{supervises ? t('subtitleTeam') : t('subtitle')}</p>
        </div>
        <div className="md:justify-self-center">
          <Segmented
            value={view}
            onChange={(v) => go({ view: v === 'day' ? null : v === 'week' ? 'week' : 'calendar' })}
            label={t('view')}
            options={[
              { value: 'day', label: t('views.day') },
              { value: 'week', label: t('views.week') },
              { value: 'month', label: t('views.month') },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-self-end">
          <TeamSelect supervises={supervises} members={members} gestor={gestor} onChange={(v) => go({ gestor: v })} />
          <button
            type="button"
            onClick={crear}
            className="h-10 shrink-0 rounded-lg bg-k-navy px-4 text-[13px] font-medium text-white hover:bg-k-slate active:scale-[.98]"
          >
            {t('createCta')}
          </button>
        </div>
      </div>

      {!supervises && (
        <p className="mb-4 rounded-xl border border-k-border bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
          {t('scopedToMine')}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <MiniCalendar
            day={day}
            today={today}
            withItems={conItems}
            onPickDay={(iso) => go({ date: iso })}
            onPickMonth={(iso) => go({ date: iso })}
          />
          <FiltersCard
            values={{ q, gestor, tipo, estado }}
            supervises={supervises}
            members={members}
            onChange={(patch) => {
              if (patch.q !== undefined) setQ(patch.q);
              const url: Record<string, string | null> = {};
              if (patch.gestor !== undefined) url.gestor = patch.gestor || null;
              if (patch.tipo !== undefined) url.tipo = patch.tipo || null;
              if (patch.estado !== undefined) url.estado = patch.estado || null;
              if (Object.keys(url).length > 0) go(url);
            }}
            onClear={() => {
              setQ('');
              go({ gestor: null, tipo: null, estado: null });
            }}
          />
          <SummaryCard items={visibles} />
        </div>

        <div className="min-w-0">
          <OverduePanel items={vencidas} total={vencidasTotal} events={events} />
          {view === 'week' ? (
            <WeekPanel
              day={day}
              today={today}
              items={delMes}
              events={events}
              onPickDay={(iso) => go({ date: iso })}
              onOpenDay={(iso) => go({ date: iso, view: null })}
            />
          ) : view === 'day' ? (
            <DayPanel
              day={day}
              today={today}
              items={visibles}
              members={members}
              filtered={hayFiltro}
              events={events}
              onPickDay={(iso) => go({ date: iso })}
            />
          ) : (
            <div className="rounded-2xl border border-k-border bg-white p-3 shadow-k-card sm:p-4">
              <MonthCalendar
                month={day}
                today={today}
                items={delMes}
                onPickDay={(iso) => go({ date: iso, view: null })}
                onPickMonth={(iso) => go({ date: iso })}
                events={events}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * El selector de equipo de la cabecera. Es **el mismo** `gestor` del filtro de cobrador (misma URL, mismos
 * permisos): con `agenda:assign` se elige a quién mirar o a todo el equipo; sin él, la API ya devuelve sólo lo
 * propio y no hay nada que elegir.
 */
function TeamSelect({
  supervises,
  members,
  gestor,
  onChange,
}: {
  supervises: boolean;
  members: Member[];
  gestor: string;
  onChange: (gestorId: string) => void;
}) {
  const t = useTranslations('panel.agenda');
  const box = 'relative flex h-10 min-w-[190px] flex-col justify-center rounded-lg border border-k-border bg-white px-3';

  if (!supervises) {
    return (
      <div className={box}>
        <span className="text-[13px] font-medium text-k-navy">{t('team.justMe')}</span>
      </div>
    );
  }

  const elegido = members.find((m) => m.userId === gestor);
  return (
    <label className={`${box} cursor-pointer hover:bg-k-bg`}>
      <span className="text-[13px] font-semibold leading-tight text-k-navy">
        {elegido ? memberName(elegido) : t('team.mine')}
      </span>
      <span className="text-[11px] leading-tight text-k-text-2">
        {elegido ? t('team.label') : t('team.count', { n: members.length })}
      </span>
      <select
        aria-label={t('team.label')}
        value={gestor}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <option value="">{t('team.all')}</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {memberName(m)}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-k-text-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  );
}
