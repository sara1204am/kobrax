'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/modal';
import { LocationPicker, type Loc } from '../../agenda/location-picker';

/** La ubicación elegida para una parada: lo que el planificador necesita saber de ella. */
export interface ChosenLocation {
  id: string;
  /** «Garante · Calle 5», para mostrarla en el recorrido. */
  label: string;
  latitude?: number;
  longitude?: number;
  /** Su foto principal: la que se ve chica en el mapa. */
  photoUrl?: string;
}

/**
 * **Elegir (o cargar) la ubicación concreta de una parada** (F4/12 · decisiones 6 y 7): un cliente no es una dirección —puede
 * tener domicilio, trabajo, un garante, un familiar— y la ruta tiene que saber **a cuál de esas se va**.
 *
 * Reusa el selector de la agenda entero (`LocationPicker`): elegir una que ya existe, **cargar una nueva** o **marcarle
 * el punto en el mapa** a una importada sin coordenadas. Es lo que vuelve accionable el «Sin ubicación»: el planificador
 * no deja publicar una ruta con una parada que no se puede dibujar, y acá se resuelve sin salir de la pantalla.
 *
 * Las ubicaciones se piden al abrir (`GET /api/agenda/context/:clientId`, una lectura que la API audita): pedirlas para
 * cada candidato de la lista dejaría un rastro de revelado por cada fila mirada de reojo.
 */
export function PlanLocationDialog({
  open,
  onClose,
  clientId,
  clientName,
  chosenId,
  onChoose,
  near,
}: {
  /** Un punto cercano (las paradas de la ruta) para abrir el mapa cerca cuando la dirección no tiene punto. */
  near?: { latitude: number; longitude: number };
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName?: string;
  chosenId?: string;
  onChoose: (location: ChosenLocation) => void;
}) {
  const t = useTranslations('panel.routes.planning.location');
  const tType = useTranslations('portfolio.locationType');
  const tRel = useTranslations('portfolio.relationType');
  const [locs, setLocs] = useState<Loc[]>([]);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/agenda/context/${clientId}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) return setError(body?.error?.message ?? t('error'));
        const list: Loc[] = Array.isArray(body?.locations) ? body.locations : [];
        setLocs(list);
        setValue(list.find((l) => l.id === chosenId)?.id ?? list.find((l) => l.latitude != null)?.id ?? list[0]?.id ?? '');
      })
      .catch(() => !cancelled && setError(t('error')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, clientId, chosenId, t]);

  const chosen = locs.find((l) => l.id === value);
  const hasPoint = chosen?.latitude != null && chosen.longitude != null;

  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={t('title', { name: clientName ?? '' })}
      actions={
        <>
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-text-2 hover:bg-k-bg">
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={!chosen || !hasPoint}
            onClick={() => {
              if (!chosen) return;
              onChoose({
                id: chosen.id,
                // «Garante · Juan Pérez (Garante) · Calle 5»: el tipo de lugar, de quién es y dónde.
                label: [
                  tType(chosen.locationType as 'HOME'),
                  chosen.ownerName
                    ? chosen.ownerRelation
                      ? `${chosen.ownerName} (${tRel(chosen.ownerRelation as 'GUARANTOR')})`
                      : chosen.ownerName
                    : null,
                  chosen.address,
                ]
                  .filter(Boolean)
                  .join(' · '),
                latitude: chosen.latitude,
                longitude: chosen.longitude,
                photoUrl: chosen.photoUrls?.[0],
              });
              onClose();
            }}
            className="h-10 rounded-xl bg-k-navy px-5 text-[14px] font-semibold text-white hover:bg-k-slate disabled:opacity-50"
          >
            {t('use')}
          </button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-k-text-2">{t('hint')}</p>
      {loading && <p className="text-[14px] text-k-text-2">{t('loading')}</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-k-danger bg-k-danger-bg px-3 py-2 text-[13px] text-k-text">
          {error}
        </p>
      )}
      {!loading && !error && (
        <>
          <LocationPicker
            clientId={clientId}
            locations={locs}
            near={near}
            value={value}
            onChange={setValue}
            onAdded={(l) => {
              setLocs((prev) => [...prev, l]);
              setValue(l.id);
            }}
            onUpdated={(l) => setLocs((prev) => prev.map((x) => (x.id === l.id ? l : x)))}
          />
          {chosen && !hasPoint && <p className="mt-3 text-[13px] text-k-warning-text">{t('needsPoint')}</p>}
        </>
      )}
    </Modal>
  );
}
