'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { ClientContactDetail, ClientLocationDetail } from '@kobrax/shared';
import { Icon } from '@/components/panel-shell';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';

/**
 * El mapa se carga **sólo cuando alguien abre el modal**.
 *
 * 🔴 `maplibre` son ~250 kB. Importándolo arriba, cada ficha de cliente los baja para un link que
 * casi nadie toca. Con `dynamic` + `ssr: false` el chunk sale recién al pedirlo.
 */
const RouteMap = dynamic(() => import('@/components/route-map').then((m) => m.RouteMap), { ssr: false });

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

  return (
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
              action={!revealed && <RevealButton onClick={onReveal} busy={busy} />}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Direcciones. El «Ver en mapa» sólo aparece si hay punto: sin coordenadas no hay nada que abrir. */
export function LocationList({
  rows,
  revealed,
  onReveal,
  busy,
  canWrite,
  onEdit,
}: Común & { rows: ClientLocationDetail[]; onEdit: () => void }) {
  const t = useTranslations('portfolio');
  const [enMapa, setEnMapa] = useState<ClientLocationDetail | null>(null);

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
                    {!revealed && <RevealButton onClick={onReveal} busy={busy} />}
                    {l.latitude != null && l.longitude != null && (
                      <button
                        type="button"
                        onClick={() => setEnMapa(l)}
                        className="text-[12px] font-medium text-k-periwinkle hover:underline"
                      >
                        {t('seeOnMap')}
                      </button>
                    )}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <Modal open={enMapa !== null} onClose={() => setEnMapa(null)} title={enMapa?.address ?? t('sections.locations')}>
        {enMapa && (
          <RouteMap
            height={340}
            stops={[
              {
                id: enMapa.id,
                sequenceOrder: 1,
                latitude: enMapa.latitude,
                longitude: enMapa.longitude,
                label: enMapa.address ?? undefined,
              },
            ]}
          />
        )}
      </Modal>
    </>
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
