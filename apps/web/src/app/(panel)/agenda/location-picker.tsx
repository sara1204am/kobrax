'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { locationTypeChoices } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Icon } from '@/components/panel-shell';
import { postJson } from '@/lib/client';

/**
 * MapLibre son 250 kB y esto vive dentro del alta de una gestión: la mayoría de las gestiones no son
 * visitas, y las que lo son suelen elegir una dirección que ya existe. Se baja cuando se abre el
 * mapa, no cuando se abre el formulario. `ssr: false` porque necesita `window`.
 */
const MapPicker = dynamic(() => import('@/components/map-picker').then((m) => m.MapPicker), { ssr: false });

export interface Loc {
  id: string;
  locationType: string;
  address: string | null;
  zone?: string;
  latitude?: number;
  longitude?: number;
}

/** Lo que se está tipeando en el alta. Las coordenadas van como texto: un campo a medio escribir no es un número. */
interface Borrador {
  locationType: string;
  address: string;
  zone: string;
  referenceNotes: string;
  latitude: string;
  longitude: string;
}

const VACIO: Borrador = { locationType: 'HOME', address: '', zone: '', referenceNotes: '', latitude: '', longitude: '' };

/** `''` → `undefined`, y un número mal tipeado tampoco viaja: la API lo rechazaría con un 400 críptico. */
function coord(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : n;
}

/**
 * Elegir la dirección de una visita, verla en el mapa, o cargar una que no estaba.
 *
 * 🔴 **El alta de dirección vive acá y no en la ficha del cliente**, aunque escriba en el cliente.
 * Quien agenda una visita se entera de que falta la dirección justo en este momento, y mandarlo a la
 * cartera a cargarla y volver le hace perder lo que ya llenó del formulario. La API tiene una puerta
 * propia para esto (`AGENDA_WRITE`, no `CLIENT_WRITE`): un cobrador carga el domicilio al que va a
 * ir sin quedar habilitado a administrar clientes.
 *
 * ⚠️ **La dirección se guarda al instante**, no cuando se guarda la gestión: la API necesita su id
 * para poder referenciarla en `details.locationId`. Si después se cancela el alta, la dirección
 * queda cargada igual — que es lo correcto, el dato del deudor es verdadero aunque la visita no se
 * agende.
 */
export function LocationPicker({
  locations,
  value,
  onChange,
  onAdded,
  clientId,
  disabled,
}: {
  locations: Loc[];
  value: string;
  onChange: (id: string) => void;
  onAdded: (l: Loc) => void;
  clientId: string;
  disabled?: boolean;
}) {
  const t = useTranslations('panel.agenda');
  const tp = useTranslations('portfolio');

  const [verMapa, setVerMapa] = useState(false);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState<Borrador>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegida = locations.find((l) => l.id === value);
  const conPunto = elegida?.latitude != null && elegida.longitude != null;
  const set = (patch: Partial<Borrador>) => setForm((f) => ({ ...f, ...patch }));

  /*
   * El GPS del navegador, que es el mismo permiso que pide el teléfono. Si lo niegan no se bloquea
   * nada: el mapa y los dos campos siguen ahí, y el punto es opcional de todos modos.
   */
  function miUbicacion() {
    if (!navigator.geolocation) return setError(t('create.noGeo'));
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUbicando(false);
        set({ latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) });
      },
      () => {
        setUbicando(false);
        setError(t('create.geoDenied'));
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  async function guardar() {
    setError(null);
    setGuardando(true);
    const res = await postJson(`/api/agenda/context/${clientId}/locations`, {
      locationType: form.locationType,
      address: form.address.trim(),
      ...(form.zone.trim() ? { zone: form.zone.trim() } : {}),
      ...(form.referenceNotes.trim() ? { referenceNotes: form.referenceNotes.trim() } : {}),
      ...(coord(form.latitude) != null ? { latitude: coord(form.latitude) } : {}),
      ...(coord(form.longitude) != null ? { longitude: coord(form.longitude) } : {}),
    });
    setGuardando(false);
    if (!res.ok) return setError(res.data.error?.message ?? t('create.locationError'));

    onAdded(res.data as unknown as Loc);
    setForm(VACIO);
    setCreando(false);
    setVerMapa(false);
  }

  return (
    <div className="space-y-3">
      <Field label={t('create.location')}>
        <div className="flex items-center gap-2">
          <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="flex-1">
            {locations.length === 0 && <option value="">{t('create.noLocations')}</option>}
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.address ?? '—'} {l.zone ? `· ${l.zone}` : ''}
              </option>
            ))}
          </Select>
          {/*
           * El ojo sólo aparece cuando hay punto que mirar. Una dirección importada de un extracto
           * es texto y nada más: un botón que abre un mapa vacío promete algo que no puede cumplir.
           */}
          {conPunto && (
            <button
              type="button"
              onClick={() => setVerMapa((v) => !v)}
              aria-label={verMapa ? t('create.hideMap') : t('create.seeOnMap')}
              aria-pressed={verMapa}
              title={verMapa ? t('create.hideMap') : t('create.seeOnMap')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-k-border text-k-text-2 hover:bg-k-bg"
            >
              <Icon name={verMapa ? 'eyeOff' : 'eye'} className="h-4 w-4" />
            </button>
          )}
        </div>
      </Field>

      {conPunto && verMapa && (
        <MapPicker latitude={elegida!.latitude} longitude={elegida!.longitude} height={220} label={t('create.mapView')} />
      )}

      {!creando ? (
        <button
          type="button"
          onClick={() => setCreando(true)}
          disabled={disabled}
          className="text-[13px] font-medium text-k-periwinkle hover:underline disabled:opacity-50"
        >
          {t('create.addLocation')}
        </button>
      ) : (
        <div className="space-y-4 rounded-xl border border-k-border bg-k-bg p-4">
          <ErrorBanner message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tp('form.locationType')}>
              <Select value={form.locationType} onChange={(e) => set({ locationType: e.target.value })} disabled={guardando}>
                {locationTypeChoices().map((v) => (
                  <option key={v} value={v}>
                    {tp(`locationType.${v}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tp('form.zone')}>
              <Input value={form.zone} onChange={(e) => set({ zone: e.target.value })} disabled={guardando} maxLength={100} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={tp('form.address')}>
                <Input value={form.address} onChange={(e) => set({ address: e.target.value })} disabled={guardando} maxLength={200} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={tp('form.reference')}>
                <Input
                  value={form.referenceNotes}
                  onChange={(e) => set({ referenceNotes: e.target.value })}
                  disabled={guardando}
                  maxLength={200}
                />
              </Field>
            </div>
          </div>

          {/*
           * El mapa y los dos campos son la MISMA coordenada, no dos formas de cargar cosas
           * distintas: tocar el mapa escribe los números y escribirlos mueve el pin. Quien tiene el
           * punto anotado lo tipea; quien lo conoce de vista lo marca.
           */}
          <MapPicker
            latitude={coord(form.latitude)}
            longitude={coord(form.longitude)}
            onChange={({ latitude, longitude }) =>
              set({ latitude: latitude.toFixed(5), longitude: longitude.toFixed(5) })
            }
            label={t('create.mapPick')}
          />
          <p className="text-[12px] text-k-text-2">
            {coord(form.latitude) != null && coord(form.longitude) != null
              ? t('create.pinAt', { lat: form.latitude, lng: form.longitude })
              : t('create.pinHint')}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tp('form.latitude')}>
              <Input
                value={form.latitude}
                onChange={(e) => set({ latitude: e.target.value })}
                disabled={guardando}
                type="number"
                step="any"
                min={-90}
                max={90}
              />
            </Field>
            <Field label={tp('form.longitude')}>
              <Input
                value={form.longitude}
                onChange={(e) => set({ longitude: e.target.value })}
                disabled={guardando}
                type="number"
                step="any"
                min={-180}
                max={180}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-full sm:w-56">
              <Button variant="ghost" onClick={miUbicacion} loading={ubicando} disabled={guardando}>
                {t('create.useMyLocation')}
              </Button>
            </span>
            <span className="ml-auto flex gap-2">
              <span className="w-32">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCreando(false);
                    setForm(VACIO);
                    setError(null);
                  }}
                  disabled={guardando}
                >
                  {t('create.cancel')}
                </Button>
              </span>
              <span className="w-44">
                <Button onClick={() => void guardar()} loading={guardando} disabled={!form.address.trim()}>
                  {t('create.saveLocation')}
                </Button>
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
