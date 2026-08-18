'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AgendaItemType, memberName, type AgendaListItem, type Member } from '@kobrax/shared';
import { dayMetrics, loadByDay, type DayLoad } from '@/lib/agenda';
import { Select } from '@/components/ui';
import { DateNav } from './date-nav';
import { DayList } from './day-list';
import { MonthCalendar } from './month-calendar';
import { OverduePanel } from './overdue-panel';

/**
 * Lo que la pantalla **pide** que pase. No lo hace ella.
 *
 * 🔴 Crear, ver y ejecutar una gestión son pantallas y modales que ya existen en otro lado. Si esta
 * pantalla los abriera, cada una de esas tres cosas tendría dos implementaciones que se van
 * separando. Acá se emite el pedido y quien la usa decide qué abrir.
 */
export interface AgendaEvents {
  onCreateRequest: (input: { date: string; time?: string; gestorId?: string }) => void;
  onViewRequest: (id: string) => void;
  onCompleteRequest: (id: string) => void;
  onCallRequest: (id: string) => void;
}

/** Con qué preferencia abre la pantalla la próxima vez. Es de mirada, no un dato: va en el navegador. */
const VIEW_KEY = 'kbx.agenda.view';

/**
 * La agenda: **el día, y dónde está el trabajo**.
 *
 * 🔴 **El estado vive en la URL** —día, vista y filtros—, no adentro. Así la vista se comparte por
 * link, «atrás» funciona, y cambiar de Lista a Calendario conserva el día y los filtros sin una
 * línea de código para sincronizarlos: son el mismo parámetro leído dos veces.
 *
 * 🔴 **Los filtros se aplican acá y no en la API, y es correcto**: `GET /agenda` devuelve el día
 * entero sin paginar. Filtrar en el navegador sobre algo que ya llegó completo no esconde nada —lo
 * que sí escondería es filtrar una página de veinte y llamarla «el día».
 */
export function AgendaScreen({
  day,
  today,
  items,
  weekItems,
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
  /** Las de la semana visible — sólo para pintar la carga de cada día en la tira. */
  weekItems: AgendaListItem[];
  /** Las del mes; vacío cuando se está en Lista y no hace falta pedirlas. */
  monthItems: AgendaListItem[];
  overdue: AgendaListItem[];
  overdueTotal: number;
  members: Member[];
  /** Con `agenda:assign` se ve el equipo: aparece el filtro por cobrador y la lista se agrupa. */
  supervises: boolean;
  events: AgendaEvents;
}) {
  const t = useTranslations('panel.agenda');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const gestor = params.get('gestor') ?? '';
  const tipo = params.get('tipo') ?? '';

  /** Escribe en la URL sin perder lo que ya había: es lo que conserva día y filtros al cambiar de vista. */
  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next}`);
  }

  // La preferencia de vista sobrevive a cerrar el navegador; el día no, porque el día es hoy.
  useEffect(() => {
    if (params.has('view')) localStorage.setItem(VIEW_KEY, view);
  }, [view, params]);
  useEffect(() => {
    if (params.has('view')) return;
    if (localStorage.getItem(VIEW_KEY) === 'calendar') go({ view: 'calendar' });
    // Sólo al montar: después manda la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** El filtrado, una vez, para la lista y para las métricas — o el porcentaje mentiría. */
  const visibles = useMemo(
    () => items.filter((i) => (!gestor || i.assigneeId === gestor) && (!tipo || i.type === tipo)),
    [items, gestor, tipo],
  );
  const metrics = dayMetrics(visibles);
  const carga: Map<string, DayLoad> = useMemo(() => loadByDay(weekItems), [weekItems]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight text-k-navy">{t('title')}</h1>
          <p className="mt-1 text-[14px] text-k-text-2">{supervises ? t('subtitleTeam') : t('subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ViewToggle view={view} onChange={(v) => go({ view: v === 'list' ? null : v })} />
          <button
            type="button"
            onClick={() => events.onCreateRequest({ date: day, gestorId: gestor || undefined })}
            className="h-9 rounded-lg bg-k-navy px-3 text-[13px] font-medium text-white hover:bg-k-slate active:scale-[.98]"
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

      {view === 'list' && <DateNav day={day} today={today} load={carga} onPick={(iso) => go({ date: iso })} />}

      <Filtros
        supervises={supervises}
        members={members}
        gestor={gestor}
        tipo={tipo}
        onChange={(patch) => go(patch)}
      />

      <OverduePanel items={overdue} total={overdueTotal} events={events} />

      {view === 'list' ? (
        <>
          <Metrics total={metrics.total} done={metrics.done} donePct={metrics.donePct} overdue={metrics.overdue} />
          <div className="mt-4">
            <DayList items={visibles} members={members} grouped={supervises} events={events} day={day} />
          </div>
        </>
      ) : (
        <MonthCalendar
          month={day}
          today={today}
          items={monthItems.filter((i) => (!gestor || i.assigneeId === gestor) && (!tipo || i.type === tipo))}
          onPickDay={(iso) => go({ date: iso, view: null })}
          onPickMonth={(iso) => go({ date: iso })}
          events={events}
        />
      )}
    </>
  );
}

/** Lista o calendario. `radiogroup` y no dos botones sueltos: se recorre con flechas. */
function ViewToggle({ view, onChange }: { view: 'list' | 'calendar'; onChange: (v: 'list' | 'calendar') => void }) {
  const t = useTranslations('panel.agenda');
  return (
    <div role="radiogroup" aria-label={t('view')} className="flex rounded-lg border border-k-border bg-white p-0.5">
      {(['list', 'calendar'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => onChange(v)}
          className={`h-8 rounded-md px-3 text-[13px] font-medium transition-colors ${
            view === v ? 'bg-k-navy text-white' : 'text-k-text-2 hover:bg-k-bg'
          }`}
        >
          {t(`views.${v}`)}
        </button>
      ))}
    </div>
  );
}

function Filtros({
  supervises,
  members,
  gestor,
  tipo,
  onChange,
}: {
  supervises: boolean;
  members: Member[];
  gestor: string;
  tipo: string;
  onChange: (patch: Record<string, string | null>) => void;
}) {
  const t = useTranslations('panel.agenda');
  // Sin equipo que mostrar y sin tipo elegido, la barra no tendría nada que ofrecer.
  const conGestor = supervises && members.length > 0;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {conGestor && (
        <label className="flex items-center gap-2 text-[13px] text-k-text-2">
          {t('filters.assignee')}
          <Select
            value={gestor}
            onChange={(e) => onChange({ gestor: e.target.value || null })}
            className="h-9 w-auto min-w-[160px] text-[13px]"
          >
            <option value="">{t('filters.all')}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberName(m)}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label className="flex items-center gap-2 text-[13px] text-k-text-2">
        {t('filters.type')}
        <Select
          value={tipo}
          onChange={(e) => onChange({ tipo: e.target.value || null })}
          className="h-9 w-auto min-w-[150px] text-[13px]"
        >
          <option value="">{t('filters.all')}</option>
          {Object.values(AgendaItemType).map((v) => (
            <option key={v} value={v}>
              {t(`type.${v}`)}
            </option>
          ))}
        </Select>
      </label>
      {(gestor || tipo) && (
        <button
          type="button"
          onClick={() => onChange({ gestor: null, tipo: null })}
          className="text-[13px] font-medium text-k-periwinkle hover:underline"
        >
          {t('filters.clear')}
        </button>
      )}
    </div>
  );
}

/**
 * Las tres cifras del día.
 *
 * ⚠️ **No hay «cartera del día» en plata**, y no es un olvido: `AgendaListItem` no trae monto —la
 * agenda agenda gestiones, no deudas—. Poner una cifra ahí obligaba a pedir cada crédito por
 * separado, y una tarjeta con un número inventado es peor que una tarjeta menos.
 */
function Metrics({ total, done, donePct, overdue }: { total: number; done: number; donePct: number; overdue: number }) {
  const t = useTranslations('panel.agenda');
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Card label={t('metrics.total')} value={String(total)} />
      <Card label={t('metrics.done')} value={`${done}`} hint={total > 0 ? `${donePct}%` : undefined} tone="success" />
      <Card label={t('metrics.overdue')} value={String(overdue)} tone={overdue > 0 ? 'danger' : undefined} />
    </div>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'success' | 'danger' }) {
  const color = tone === 'danger' ? 'text-k-danger' : tone === 'success' ? 'text-k-success' : 'text-k-navy';
  return (
    <div className="rounded-xl border border-k-border bg-white px-4 py-3">
      <p className="text-[12px] text-k-text-2">{label}</p>
      <p className={`mt-0.5 text-[22px] font-semibold tabular-nums ${color}`}>
        {value}
        {hint && <span className="ml-1.5 text-[13px] font-normal text-k-text-2">{hint}</span>}
      </p>
    </div>
  );
}
