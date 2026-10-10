'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { ClientContactDetail, ClientLocationDetail } from '@kobrax/shared';
import { Icon } from '@/components/panel-shell';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { PhotoViewer } from '@/components/photo-viewer';

/**
 * El mapa se carga **sólo cuando alguien abre el modal**.
 *
 * 🔴 `maplibre` son ~250 kB. Importándolo arriba, cada ficha de cliente los baja para un ojo que
 * casi nadie toca. Con `dynamic` + `ssr: false` el chunk sale recién al pedirlo.
 *
 * Es `MapPicker` sin `onChange` —el visor— y no `RouteMap`: acá hay un punto, no un recorrido.
 */
const MapPicker = dynamic(() => import('@/components/map-picker').then((m) => m.MapPicker), { ssr: false });

/** Lo que las dos listas comparten: el revelado de la ficha y si se puede escribir. */
interface Común {
  revealed: boolean;
  onReveal: () => void;
  busy: boolean;
  canWrite: boolean;
}

/**
 * Teléfonos y correos.
 *
 * 🔴 **«Mostrar» revela la ficha ENTERA, no ese campo.** Es la decisión de producto: una persona
 * mirando un cliente deja **una** entrada de auditoría, que es la verdad de lo que pasó. Una entrada
 * por dato llenaría el registro de ruido justo el día que haya que leerlo. Por eso, al tocar
 * cualquier «Mostrar», todos los valores quedan en claro y los botones desaparecen.
 *
 * 🔴 **Se corrige en un modal, igual que las otras cuatro secciones.** Estuvo un rato editándose en
 * la propia tarjeta —son dos controles y un par de tildes, parecía de más abrir un diálogo—, pero la
 * ficha terminaba con dos comportamientos: una sección que crecía en el lugar y cuatro que abrían
 * algo. Una sola forma de corregir se aprende una vez.
 */
export function ContactList({
  rows,
  revealed,
  onReveal,
  busy,
  canWrite,
  onEdit,
}: Común & { rows: ClientContactDetail[]; onEdit: () => void }) {
  const t = useTranslations('portfolio');
  const [viendo, setViendo] = useState<ClientContactDetail | null>(null);

  return (
    <>
      <Section
        title={t('sections.contacts')}
        action={canWrite && <EditarLink onClick={onEdit} busy={busy} />}
      >
        {rows.length === 0 ? (
          <p className="text-[13px] text-k-muted">{t('noContacts')}</p>
        ) : (
          <ul className="divide-y divide-k-border">
            {rows.map((c) => (
              <Fila
                key={c.id}
                icon={c.contactType === 'EMAIL' ? 'mail' : 'phone'}
                value={c.value ?? '—'}
                hint={t(`contactType.${c.contactType}`)}
                badge={c.isPrimary ? t('primary') : undefined}
                action={
                  <span className="flex shrink-0 items-center gap-2">
                    {!revealed && <RevealButton onClick={onReveal} busy={busy} />}
                    <EyeButton onClick={() => setViendo(c)} />
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <Modal open={viendo !== null} onClose={() => setViendo(null)} title={t('sections.contacts')}>
        {/* Se pinta el de `rows` y no la copia de `viendo`: si revelan con el modal abierto, el valor
            se destapa acá también. */}
        {viendo && <ContactDetail contact={rows.find((c) => c.id === viendo.id) ?? viendo} />}
      </Modal>
    </>
  );
}

/**
 * Direcciones.
 *
 * El ojo abre **todo** lo de la dirección —tipo, zona, referencia, coordenadas— y el mapa si hay
 * punto. Antes había un «Ver en mapa» que sólo aparecía con coordenadas, y la referencia («portón
 * verde frente a la cancha»), que es lo que de verdad sirve para llegar, no se veía en ningún lado.
 */
export function LocationList({
  rows,
  revealed,
  onReveal,
  busy,
  canWrite,
  onEdit,
}: Común & { rows: ClientLocationDetail[]; onEdit: () => void }) {
  const t = useTranslations('portfolio');
  const [viendo, setViendo] = useState<ClientLocationDetail | null>(null);
  const actual = viendo && (rows.find((l) => l.id === viendo.id) ?? viendo);

  return (
    <>
      <Section title={t('sections.locations')} action={canWrite && <EditarLink onClick={onEdit} busy={busy} />}>
        {rows.length === 0 ? (
          <p className="text-[13px] text-k-muted">{t('noLocations')}</p>
        ) : (
          <ul className="divide-y divide-k-border">
            {rows.map((l) => (
              <Fila
                key={l.id}
                icon="routes"
                value={l.address ?? '—'}
                hint={[t(`locationType.${l.locationType}`), l.zone].filter(Boolean).join(' · ')}
                action={
                  <span className="flex shrink-0 items-center gap-2">
                    {/* La foto principal, chica: es lo que permite reconocer la casa sin abrir el detalle. */}
                    {l.photoUrls?.[0] && (
                      <button type="button" onClick={() => setViendo(l)} aria-label={t('photos.title')} className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element -- la sirve el BFF con la sesión */}
                        <img src={l.photoUrls[0]} alt="" loading="lazy" className="h-9 w-9 rounded-md border border-k-border object-cover" />
                      </button>
                    )}
                    {!revealed && <RevealButton onClick={onReveal} busy={busy} />}
                    <EyeButton onClick={() => setViendo(l)} />
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <Modal wide open={actual !== null} onClose={() => setViendo(null)} title={actual?.address ?? t('sections.locations')}>
        {actual && <LocationDetail location={actual} />}
      </Modal>
    </>
  );
}

// ── Detalle (lo usan también los garantes) ──────────────────────────────────

/** Todo lo de un teléfono o correo. Enmascarado o en claro, según cómo esté la ficha. */
export function ContactDetail({ contact }: { contact: ClientContactDetail }) {
  const t = useTranslations('portfolio');
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <Dato label={t('form.contactType')} value={t(`contactType.${contact.contactType}`)} />
      <Dato label={t('form.contactValue')} value={contact.value ?? '—'} />
      <Dato label={t('primary')} value={contact.isPrimary ? t('yes') : t('no')} />
      {contact.isVerified != null && <Dato label={t('verified')} value={contact.isVerified ? t('yes') : t('no')} />}
      {contact.notes && <Dato label={t('form.notes')} value={contact.notes} wide />}
    </dl>
  );
}

/**
 * Todo lo de una dirección y, si tiene punto, el mapa.
 *
 * Sin coordenadas se dice que no hay punto en vez de esconder el mapa sin explicación: una
 * dirección importada de un extracto es texto y nada más, y quien mira tiene que saber que el
 * punto falta —y que se carga desde «Editar»—, no preguntarse si el mapa no cargó.
 */
export function LocationDetail({ location }: { location: ClientLocationDetail }) {
  const t = useTranslations('portfolio');
  const conPunto = location.latitude != null && location.longitude != null;
  const fotos = location.photoUrls ?? [];
  /** Cuál foto se está mirando en grande (`null` = ninguna). */
  const [foto, setFoto] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {/* Las fotos primero: reconocer la casa es lo que se mira antes que el texto. La primera es la principal. */}
      {fotos.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('photos.title')}</h3>
          <ul className="flex flex-wrap gap-3">
            {fotos.map((url, i) => (
              <li key={url} className="relative">
                <button type="button" onClick={() => setFoto(i)} aria-label={t('photos.alt', { n: i + 1 })}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- la sirve el BFF con la sesión */}
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className={`h-24 w-32 rounded-lg border-2 object-cover ${i === 0 ? 'border-k-purple' : 'border-k-border'}`}
                  />
                </button>
                {i === 0 && (
                  <span className="absolute left-1 top-1 rounded bg-k-purple px-1.5 py-0.5 text-[10px] font-semibold text-white">{t('photos.main')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <PhotoViewer
        open={foto !== null}
        onClose={() => setFoto(null)}
        title={t(`locationType.${location.locationType}`)}
        address={location.address ?? undefined}
        photos={fotos}
        initialIndex={foto ?? 0}
      />
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Dato label={t('form.locationType')} value={t(`locationType.${location.locationType}`)} />
        <Dato label={t('form.zone')} value={location.zone || '—'} />
        <Dato label={t('form.address')} value={location.address ?? '—'} wide />
        <Dato label={t('form.reference')} value={location.referenceNotes || '—'} wide />
        <Dato label={t('coordinates')} value={conPunto ? `${location.latitude}, ${location.longitude}` : t('noPoint')} wide />
      </dl>
      {conPunto && (
        <MapPicker
          key={location.id}
          latitude={location.latitude}
          longitude={location.longitude}
          height={300}
          label={t('mapView')}
        />
      )}
    </div>
  );
}

export function Dato({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] text-k-text">{value}</dd>
    </div>
  );
}

/** El ojo que abre el detalle. Siempre está: el detalle tiene más que el mapa. */
export function EyeButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('portfolio');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('details')}
      title={t('details')}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-k-text-2 hover:bg-k-bg hover:text-k-periwinkle"
    >
      <Icon name="eye" className="h-4 w-4" />
    </button>
  );
}

// ── Piezas compartidas ───────────────────────────────────────────────────────

/**
 * El «Editar» del encabezado.
 *
 * 🔴 Quien abre —y quien revela antes de abrir— es la ficha, no estas listas. Con la máscara cargada
 * guardar escribe `786***` encima del teléfono real, y esa decisión vive en un solo lugar
 * (`ClientCard.editar`) porque es la misma para las cinco secciones.
 */
function EditarLink({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  const t = useTranslations('portfolio');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-[13px] font-medium text-k-periwinkle hover:underline disabled:opacity-50"
    >
      {t('edit')}
    </button>
  );
}

function RevealButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  const t = useTranslations('portfolio');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="shrink-0 rounded-lg bg-k-highlight px-2.5 py-1 text-[12px] font-medium text-k-periwinkle hover:bg-k-light-bg disabled:opacity-50"
    >
      {busy ? t('revealing') : t('show')}
    </button>
  );
}

function Fila({
  icon,
  value,
  hint,
  badge,
  action,
}: {
  icon: 'phone' | 'mail' | 'routes';
  value: string;
  hint: string;
  badge?: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-k-highlight text-k-periwinkle">
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="truncate text-[14px] font-medium text-k-text">{value}</span>
          {badge && (
            <span className="rounded bg-k-highlight px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-k-periwinkle">
              {badge}
            </span>
          )}
        </span>
        <span className="block truncate text-[12px] text-k-muted">{hint}</span>
      </span>
      {action}
    </li>
  );
}

/*
 * Acá vivían `AddContact` y `AddLocation`: dos mini-formularios que agregaban un teléfono o una
 * dirección sueltos, con sus propios campos y su propio guardado. Se fueron con la pantalla de
 * edición: ahora la sección entera se edita —agregar incluido— con los MISMOS campos que el resto
 * del cliente, así que un teléfono cargado desde acá y uno cargado desde el alta ya no pueden
 * validarse distinto. Era el caso: aquél no pedía forma de teléfono ni ofrecía marcar WhatsApp.
 */
