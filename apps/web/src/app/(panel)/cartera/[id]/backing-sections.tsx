'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ClientDetail, ClientRelationDetail, CollateralDetail, CreditOption } from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Icon } from '@/components/panel-shell';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { PhotoViewer } from '@/components/photo-viewer';
import { money } from '@/lib/format';
import { ContactDetail, Dato, EyeButton, LocationDetail } from './client-contacts';
import { TextButton } from '@/components/ui';

/**
 * Qué respalda esta deuda: **la persona y el bien**.
 *
 * Van juntos en este archivo porque son la misma pregunta contestada de dos formas, y en pantalla
 * viven uno debajo del otro. La personal va primero: es la que más se carga y la primera a la que
 * se llama cuando el deudor no aparece.
 *
 * 🔴 **Son componentes de cliente aunque no tengan interacción, y es por el revelado.** Los
 * teléfonos y direcciones del garante **también** se destapan al pedir los datos completos —es a
 * quien se llama cuando el deudor no aparece—, así que tienen que redibujarse con la ficha
 * revelada. Renderizados en el servidor quedarían tapados para siempre: el `reveal` reemplaza el
 * cliente en memoria, y lo que ya se pintó del lado del server no se entera.
 */

/**
 * 🔴 **Agregar abre el modal de ESTA sección, no otra pantalla.**
 *
 * Antes era un link a `/cartera/:id/editar`: tocar «Agregar garante» —un botón de un bloque de la
 * columna derecha— tiraba el formulario entero del cliente encima, con otro título y otro orden, y
 * había que ir a buscar dónde había quedado la caja de garantes. Ahora cambia sólo esta sección.
 *
 * Sigue sin ser un alta en línea: un garante son cinco campos más sus teléfonos, sus direcciones y
 * qué créditos respalda. Un alta en línea con sólo el nombre crea una ficha a medias que nadie
 * vuelve a completar, y el día que haya que llamar a ese garante no va a haber a qué número.
 */
function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-k-highlight px-3 text-k-sm font-medium text-k-periwinkle hover:bg-k-light-bg"
    >
      + {label}
    </button>
  );
}

/** El vacío con su ícono y su salida. Un vacío que sólo dice «no hay» deja a la persona sin qué hacer. */
function Vacio({ icon, text, action }: { icon: 'team' | 'security'; text: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-center">
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-k-bg text-k-muted">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="text-k-sm text-k-text-2">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** El «Editar» del encabezado de la sección. Con la lista vacía no aparece: ahí está el «+ Agregar». */
function EditarLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <TextButton type="button" onClick={onClick} tone="periwinkle">
      {label}
    </TextButton>
  );
}

/**
 * Los garantes.
 *
 * No son una entidad propia: son `relations`, y sus teléfonos y direcciones cuelgan de ellos por
 * `relationId` —las mismas tablas que las del cliente—.
 */
export function GuarantorsSection({
  client,
  canWrite,
  onEdit,
}: {
  client: ClientDetail;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('portfolio');
  const rows = client.relations ?? [];
  const [viendo, setViendo] = useState<string | null>(null);
  // Por id y no la fila guardada: si revelan la ficha, el modal muestra los datos en claro.
  const actual = rows.find((r) => r.id === viendo) ?? null;

  return (
    <>
    <Section
      title={t('sections.guarantors')}
      inner=""
      action={canWrite && rows.length > 0 ? <EditarLink onClick={onEdit} label={t('edit')} /> : undefined}
    >
      {rows.length === 0 ? (
        <Vacio
          icon="team"
          text={t('noGuarantors')}
          action={canWrite ? <AddButton onClick={onEdit} label={t('form.addRelation')} /> : undefined}
        />
      ) : (
        <ul className="divide-y divide-k-border">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-k-base font-medium text-k-text">{r.relatedName}</p>
                <EyeButton onClick={() => setViendo(r.id)} />
              </div>
              <p className="text-k-xs text-k-muted">
                {t(`relationType.${r.relationshipType}`)}
                {!r.isContactable && ` · ${t('notContactable')}`}
              </p>
              {/* Sus teléfonos y direcciones, enmascarados como todo lo demás. Es lo que se busca
                  cuando el deudor no aparece: a quién más llamar. */}
              {(r.contacts?.length || r.locations?.length) && (
                <p className="mt-1 text-k-xs text-k-text-2">
                  {[...(r.contacts ?? []).map((c) => c.value ?? '—'), ...(r.locations ?? []).map((l) => l.address ?? '—')].join(' · ')}
                </p>
              )}
              {/* Cuántos préstamos respalda. El número y no los códigos: acá se mira a la persona;
                  qué préstamo, en la ficha del préstamo. */}
              {r.creditIds && r.creditIds.length > 0 && (
                <p className="mt-1 text-k-xs text-k-text-2">{t('guaranteesCount', { count: r.creditIds.length })}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>

    <Modal wide open={actual !== null} onClose={() => setViendo(null)} title={actual?.relatedName ?? t('sections.guarantors')}>
      {actual && <GuarantorDetail relation={actual} />}
    </Modal>
    </>
  );
}

/**
 * Todo lo del garante en un lugar: quién es, sus teléfonos y **dónde encontrarlo**, con cada
 * dirección en su mapa. En la tarjeta de la ficha viaja todo apretado en una línea con `·`; acá se
 * lee entero el día que el deudor no aparece y hay que ir a buscar a quien responde por él.
 */
function GuarantorDetail({ relation: r }: { relation: ClientRelationDetail }) {
  const t = useTranslations('portfolio');
  const contacts = r.contacts ?? [];
  const locations = r.locations ?? [];

  return (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Dato label={t('form.relatedName')} value={r.relatedName} />
        <Dato label={t('form.relationType')} value={t(`relationType.${r.relationshipType}`)} />
        <Dato label={t('form.gender')} value={r.gender ? t(`gender.${r.gender}`) : t('gender.unset')} />
        <Dato label={t('contactableLabel')} value={r.isContactable ? t('yes') : t('no')} />
        {r.creditIds && r.creditIds.length > 0 && (
          <Dato label={t('form.guarantees')} value={t('guaranteesCount', { count: r.creditIds.length })} />
        )}
        {r.notes && <Dato label={t('form.notes')} value={r.notes} wide />}
      </dl>

      <Bloque title={t('form.relationContacts')} empty={t('noContacts')}>
        {contacts.map((c) => (
          <li key={c.id} className="rounded-xl border border-k-border bg-k-bg p-4">
            <ContactDetail contact={c} />
          </li>
        ))}
      </Bloque>

      <Bloque title={t('form.relationLocations')} empty={t('noLocations')}>
        {locations.map((l) => (
          <li key={l.id} className="rounded-xl border border-k-border bg-k-bg p-4">
            <LocationDetail location={l} />
          </li>
        ))}
      </Bloque>
    </div>
  );
}

function Bloque({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="border-t border-k-border pt-4">
      <h3 className="mb-3 text-k-2xs font-semibold uppercase tracking-wide text-k-text-2">{title}</h3>
      {children.length === 0 ? <p className="text-k-sm text-k-muted">{empty}</p> : <ul className="space-y-3">{children}</ul>}
    </section>
  );
}

/**
 * Las garantías reales: el bien.
 *
 * ⚠️ **No se enmascara.** No es PII de nadie —«Moto Honda roja 2019» no dice quién es nadie— y
 * describirla es justamente lo que sirve para encontrarla.
 */
export function CollateralsSection({
  client,
  currency,
  types,
  credits = [],
  canWrite,
  onEdit,
}: {
  client: ClientDetail;
  currency: string;
  /** Los préstamos del cliente, para decir CUÁLES respalda cada garantía (no sólo cuántos). */
  credits?: CreditOption[];
  /** Catálogo `COLLATERAL_TYPE`. Un tipo que no esté en la lista se muestra tal cual vino. */
  types: CatalogOption[];
  canWrite: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('portfolio');
  const rows = client.collaterals ?? [];
  const [viendo, setViendo] = useState<string | null>(null);
  const actual = rows.find((g) => g.id === viendo) ?? null;
  const tipoDe = (g: CollateralDetail) =>
    g.type === 'OTHER' && g.typeOther ? g.typeOther : g.type ? (types.find((c) => c.code === g.type)?.label || g.type) : null;

  return (
    <>
    <Section
      title={t('sections.collaterals')}
      inner=""
      action={canWrite && rows.length > 0 ? <EditarLink onClick={onEdit} label={t('edit')} /> : undefined}
    >
      {rows.length === 0 ? (
        <Vacio
          icon="security"
          text={t('noCollaterals')}
          action={canWrite ? <AddButton onClick={onEdit} label={t('form.addCollateral')} /> : undefined}
        />
      ) : (
        <ul className="divide-y divide-k-border">
          {rows.map((g) => (
            <li key={g.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-k-base font-medium text-k-text">{g.description || tipoDe(g) || '—'}</p>
                <p className="text-k-xs text-k-muted">
                  {[tipoDe(g), g.estimatedValue != null ? money(g.estimatedValue, g.currency ?? currency) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {g.creditIds && g.creditIds.length > 0 && (
                  <p className="mt-1 text-k-xs text-k-text-2">{t('backsCount', { count: g.creditIds.length })}</p>
                )}
              </div>
              {/* La foto principal, chica, y el ojo: igual que en las direcciones. */}
              <span className="flex shrink-0 items-center gap-2">
                {g.photoUrls?.[0] && (
                  <button type="button" onClick={() => setViendo(g.id)} aria-label={t('form.collateralPhotos')} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- la sirve el BFF con la sesión */}
                    <img src={g.photoUrls[0]} alt="" loading="lazy" className="h-9 w-9 rounded-md border border-k-border object-cover" />
                  </button>
                )}
                <EyeButton onClick={() => setViendo(g.id)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>

    <Modal wide open={actual !== null} onClose={() => setViendo(null)} title={actual ? (actual.description || tipoDe(actual) || t('sections.collaterals')) : t('sections.collaterals')}>
      {actual && <CollateralDetailView collateral={actual} typeLabel={tipoDe(actual)} currency={currency} credits={credits} />}
    </Modal>
    </>
  );
}

/**
 * Todo lo de una garantía, lo MISMO que se edita: tipo (y qué es si es «Otro»), descripción, valor y moneda, fotos y a qué
 * préstamos respalda (por código y saldo, no sólo cuántos).
 */
function CollateralDetailView({
  collateral: g,
  typeLabel,
  currency,
  credits,
}: {
  collateral: CollateralDetail;
  typeLabel: string | null;
  currency: string;
  credits: CreditOption[];
}) {
  const t = useTranslations('portfolio');
  const fotos = g.photoUrls ?? [];
  const [foto, setFoto] = useState<number | null>(null);
  const respalda = (g.creditIds ?? []).map((id) => credits.find((c) => c.id === id)).filter((c): c is CreditOption => Boolean(c));

  return (
    <div className="space-y-4">
      {fotos.length > 0 && (
        <section>
          <h3 className="mb-2 text-k-2xs font-semibold uppercase tracking-wide text-k-text-2">{t('form.collateralPhotos')}</h3>
          <ul className="flex flex-wrap gap-3">
            {fotos.map((url, i) => (
              <li key={url} className="relative">
                <button type="button" onClick={() => setFoto(i)} aria-label={t('photos.alt', { n: i + 1 })}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- la sirve el BFF con la sesión */}
                  <img src={url} alt="" loading="lazy" className={`h-24 w-32 rounded-lg border-2 object-cover ${i === 0 ? 'border-k-purple' : 'border-k-border'}`} />
                </button>
                {i === 0 && (
                  <span className="absolute left-1 top-1 rounded bg-k-purple px-1.5 py-0.5 text-k-3xs font-semibold text-white">{t('photos.main')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <PhotoViewer
        open={foto !== null}
        onClose={() => setFoto(null)}
        title={typeLabel ?? t('sections.collaterals')}
        address={g.description || undefined}
        photos={fotos}
        initialIndex={foto ?? 0}
      />
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Dato label={t('form.collateralType')} value={g.type === 'OTHER' ? t('form.collateralOtherType') : (typeLabel ?? '—')} />
        {g.type === 'OTHER' && <Dato label={t('form.collateralTypeOther')} value={g.typeOther || '—'} />}
        <Dato label={t('form.collateralDescription')} value={g.description || '—'} wide />
        <Dato label={t('form.collateralValue')} value={g.estimatedValue != null ? money(g.estimatedValue, g.currency ?? currency) : '—'} />
        <Dato label={t('form.collateralCurrency')} value={g.currency ?? currency} />
      </dl>
      <section className="border-t border-k-border pt-3">
        <h3 className="mb-2 text-k-2xs font-semibold uppercase tracking-wide text-k-text-2">{t('form.appliesTo')}</h3>
        {respalda.length === 0 ? (
          <p className="text-k-sm text-k-muted">{t('form.noCreditsBacked')}</p>
        ) : (
          <ul className="space-y-1 text-k-sm text-k-text">
            {respalda.map((c) => (
              <li key={c.id}>
                {c.code ?? t('form.creditNoCode')} · {money(c.outstandingBalance, c.currency)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
