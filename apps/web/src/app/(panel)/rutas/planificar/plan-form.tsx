'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberName, type Member } from '@kobrax/shared';
import { Badge, Card } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { postJson } from '@/lib/client';
import type { PlanRow } from '@/app/api/routes/plan/route';

/**
 * Armar las rutas de un día: **a quiénes, para cuándo y con cuántas paradas**.
 *
 * 🔴 **Dos pasos, no cuatro.** El plan preveía elegir visitas una por una y repartirlas a mano entre
 * cobradores; esto arranca por lo que el negocio ya hace: **cada cobrador sale con SU cartera**, y lo
 * que se decide es hasta dónde llega la jornada. Elegir visitas sueltas y moverlas de una persona a
 * otra es el refinamiento siguiente, y entra sin tocar esto: el servidor ya recibe la lista de casos.
 *
 * 🔴 **Nunca se publica sin ver antes qué va a pasar.** «Revisar» corre exactamente el mismo camino
 * que «Publicar» con `dryRun`, así que lo que se muestra es lo que se va a crear — no una estimación
 * hecha con otra cuenta. Y avisa quién **ya tiene ruta ese día**, que es el caso que de otro modo
 * aparecería como un error recién al confirmar.
 */
export function PlanForm({ collectors, defaultDate }: { collectors: Member[]; defaultDate: string }) {
  const t = useTranslations('panel.routes.planning');
  const router = useRouter();

  const [date, setDate] = useState(defaultDate);
  const [stops, setStops] = useState(8);
  const [picked, setPicked] = useState<string[]>(collectors.map((c) => c.userId));
  const [preview, setPreview] = useState<PlanRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PlanRow[] | null>(null);

  const nombre = (id: string) => memberName(collectors.find((c) => c.userId === id) ?? ({} as Member)) || id;

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson<{ rows: PlanRow[] }>('/api/routes/plan', {
      plannedDate: date,
      collectorIds: picked,
      stopsPerRoute: stops,
      dryRun,
    });
    setBusy(false);
    if (!ok) return setError(data.error?.message ?? t('error'));
    if (dryRun) setPreview(data.rows);
    else {
      setDone(data.rows);
      // La lista de rutas del día que se acaba de planificar es a dónde quiere ir cualquiera ahora.
      router.refresh();
    }
  }

  /* Cambiar cualquier cosa invalida lo revisado: si no, se publica una previa de otra fecha. */
  function change(fn: () => void) {
    fn();
    setPreview(null);
  }

  if (done) return <Resultado rows={done} date={date} nombre={nombre} />;

  const conRuta = preview?.filter((r) => r.alreadyHasRoute).length ?? 0;
  const total = preview?.filter((r) => !r.alreadyHasRoute).reduce((s, r) => s + r.stops, 0) ?? 0;
  const armables = preview?.filter((r) => !r.alreadyHasRoute && r.stops > 0).length ?? 0;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />

      <Card>
        <div className="flex flex-wrap items-end gap-5">
          <label className="block space-y-2">
            <span className="text-[14px] font-medium text-k-text">{t('date')}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => change(() => setDate(e.target.value))}
              className={INPUT}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[14px] font-medium text-k-text">{t('stops')}</span>
            <input
              type="number"
              min={1}
              max={30}
              value={stops}
              onChange={(e) => change(() => setStops(Number(e.target.value) || 1))}
              className={`${INPUT} w-24`}
            />
            {/* El número no es un capricho: es hasta dónde llega una jornada a pie. */}
            <span className="block text-[12px] text-k-muted">{t('stopsHint')}</span>
          </label>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-k-navy">{t('collectors')}</h2>
          <button
            type="button"
            onClick={() =>
              change(() => setPicked(picked.length === collectors.length ? [] : collectors.map((c) => c.userId)))
            }
            className="text-[13px] font-medium text-k-periwinkle hover:underline"
          >
            {picked.length === collectors.length ? t('none') : t('all')}
          </button>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {collectors.map((c) => (
            <li key={c.userId}>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-k-border px-3 py-2.5 hover:bg-k-bg">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-k-purple"
                  checked={picked.includes(c.userId)}
                  onChange={(e) =>
                    change(() =>
                      setPicked((prev) =>
                        e.target.checked ? [...prev, c.userId] : prev.filter((x) => x !== c.userId),
                      ),
                    )
                  }
                />
                <span className="text-[14px] text-k-text">{memberName(c)}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      {preview && (
        <Card>
          <h2 className="mb-1 text-[15px] font-semibold text-k-navy">{t('review')}</h2>
          <p className="mb-4 text-[13px] text-k-text-2">{t('reviewTotal', { routes: armables, stops: total })}</p>

          <ul className="divide-y divide-k-border rounded-xl border border-k-border">
            {preview.map((r) => (
              <li key={r.collectorId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-[180px] flex-1 text-[14px] text-k-text">{nombre(r.collectorId)}</span>
                {r.alreadyHasRoute ? (
                  // Ya tiene: no se le crea otra, y se dice acá y no con un error al confirmar.
                  <Badge tone="warning">{t('hasRoute')}</Badge>
                ) : r.stops === 0 ? (
                  <Badge tone="neutral">{t('noCases')}</Badge>
                ) : (
                  <span className="text-[14px] font-medium tabular-nums text-k-text">
                    {t('willHave', { n: r.stops })}
                  </span>
                )}
                {r.error && <span className="text-[13px] text-k-danger">{r.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="sm:w-52">
          <Button variant="ghost" onClick={() => void run(true)} loading={busy} disabled={picked.length === 0}>
            {t('preview')}
          </Button>
        </span>
        {/* Publicar sólo después de revisar, y sólo si hay algo que crear. */}
        <span className="sm:w-56">
          <Button onClick={() => void run(false)} loading={busy} disabled={!preview || armables === 0}>
            {t('publish')}
          </Button>
        </span>
      </div>
    </div>
  );
}

/** Qué se creó y qué no. Fila por fila: un «listo» sin detalle esconde a quien quedó afuera. */
function Resultado({ rows, date, nombre }: { rows: PlanRow[]; date: string; nombre: (id: string) => string }) {
  const t = useTranslations('panel.routes.planning');
  const creadas = rows.filter((r) => r.created);
  const afuera = rows.filter((r) => !r.created);

  return (
    <Card>
      <h2 className="text-[18px] font-semibold text-k-navy">{t('doneTitle', { n: creadas.length })}</h2>
      <p className="mt-1 text-[14px] text-k-text-2">{t('doneText')}</p>

      {afuera.length > 0 && (
        <ul className="mt-4 space-y-1">
          {afuera.map((r) => (
            <li key={r.collectorId} className="text-[13px] text-k-text-2">
              <span className="font-medium text-k-text">{nombre(r.collectorId)}</span> ·{' '}
              {r.error ?? (r.alreadyHasRoute ? t('hasRoute') : t('noCases'))}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 sm:w-64">
        <Button onClick={() => (window.location.href = `/rutas?date=${date}`)}>{t('seeRoutes')}</Button>
      </div>
    </Card>
  );
}

const INPUT =
  'h-11 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';
