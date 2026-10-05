'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ClientDetail, ClientRelationDetail } from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Icon } from '@/components/panel-shell';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { money } from '@/lib/format';
import { ContactDetail, Dato, EyeButton, LocationDetail } from './client-contacts';

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
      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-k-highlight px-3 text-[13px] font-medium text-k-periwinkle hover:bg-k-light-bg"
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
      <p className="text-[13px] text-k-text-2">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** El «Editar» del encabezado de la sección. Con la lista vacía no aparece: ahí está el «+ Agregar». */
function EditarLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] font-medium text-k-periwinkle hover:underline">
      {label}
    </button>
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
                <p className="text-[14px] font-medium text-k-text">{r.relatedName}</p>
                <EyeButton onClick={() => setViendo(r.id)} />
              </div>
              <p className="text-[12px] text-k-muted">
                {t(`relationType.${r.relationshipType}`)}
                {!r.isContactable && ` · ${t('notContactable')}`}
              </p>
              {/* Sus teléfonos y direcciones, enmascarados como todo lo demás. Es lo que se busca
                  cuando el deudor no aparece: a quién más llamar. */}
              {(r.contacts?.length || r.locations?.length) && (
                <p className="mt-1 text-[12px] text-k-text-2">
                  {[...(r.contacts ?? []).map((c) => c.value ?? '—'), ...(r.locations ?? []).map((l) => l.address ?? '—')].join(' · ')}
                </p>
              )}
              {/* Cuántos préstamos respalda. El número y no los códigos: acá se mira a la persona;
                  qué préstamo, en la ficha del préstamo. */}
              {r.creditIds && r.creditIds.length > 0 && (
                <p className="mt-1 text-[12px] text-k-text-2">{t('guaranteesCount', { count: r.creditIds.length })}</p>
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
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{title}</h3>
      {children.length === 0 ? <p className="text-[13px] text-k-muted">{empty}</p> : <ul className="space-y-3">{children}</ul>}
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
  canWrite,
  onEdit,
}: {
  client: ClientDetail;
  currency: string;
  /** Catálogo `COLLATERAL_TYPE`. Un tipo que no esté en la lista se muestra tal cual vino. */
  types: CatalogOption[];
  canWrite: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('portfolio');
  const rows = client.collaterals ?? [];

  return (
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
            <li key={g.id} className="px-4 py-3">
              <p className="text-[14px] font-medium text-k-text">{g.description}</p>
              <p className="text-[12px] text-k-muted">
                {[
                  g.type ? (types.find((c) => c.code === g.type)?.label || g.type) : null,
                  g.estimatedValue != null ? money(g.estimatedValue, g.currency ?? currency) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {g.creditIds && g.creditIds.length > 0 && (
                <p className="mt-1 text-[12px] text-k-text-2">{t('backsCount', { count: g.creditIds.length })}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
