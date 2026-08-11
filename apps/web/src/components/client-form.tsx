'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  emptyContact,
  emptyLocation,
  emptyRelation,
  type ClienteForm,
  type ContactRow,
  type LocationRow,
  type RelationRow,
} from '@kobrax/shared';
import { Field, Input } from '@/components/ui';

const CONTACT_TYPES = ['PHONE', 'EMAIL'] as const;
const LOCATION_TYPES = ['HOME', 'WORK', 'GUARANTOR', 'FAMILY', 'OTHER'] as const;
const RELATION_TYPES = ['GUARANTOR', 'FAMILY', 'COWORKER', 'NEIGHBOR', 'OTHER'] as const;
const STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;

const select =
  'h-[52px] w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 text-[15px] text-k-text outline-none transition-all focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-60';

/** Id de una fila nueva. Sólo vive en el navegador: la fila sin `serverId` es la que se crea. */
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `r${Date.now()}${Math.random()}`);

/**
 * El formulario de cliente, en acordeón: identificación + N teléfonos + N direcciones + N garantes.
 *
 * Es **el mismo formulario para el alta y para la edición** — el móvil llegó a esa forma después de
 * mantener dos, y la diferencia entre una y otra es de dónde sale el estado inicial, no qué campos
 * hay. Acá sólo se pinta: qué se manda y qué cambió lo deciden `buildClientePayload` y
 * `diffCliente`, en `shared`.
 *
 * Las filas de teléfono y dirección se reusan **tal cual** dentro de cada garante: en el modelo son
 * las mismas tablas, colgadas del garante por `relationId`.
 */
export function ClientFormFields({
  form,
  onChange,
  disabled,
}: {
  form: ClienteForm;
  onChange: (next: ClienteForm) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<ClienteForm>) => onChange({ ...form, ...patch });

  return (
    <div className="space-y-4">
      <Card title={t('sections.identity')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('form.clientType')}>
            <select
              value={form.clientType}
              onChange={(e) => set({ clientType: e.target.value as ClienteForm['clientType'] })}
              disabled={disabled}
              className={select}
            >
              <option value="PERSON">{t('clientType.PERSON')}</option>
              <option value="COMPANY">{t('clientType.COMPANY')}</option>
            </select>
          </Field>

          <Field label={t('fields.document')}>
            <Input
              value={form.nationalId}
              onChange={(e) => set({ nationalId: e.target.value })}
              disabled={disabled}
              placeholder={t('form.documentPlaceholder')}
            />
          </Field>

          {/* Una persona necesita nombre y apellido; una empresa, razón social. Lo exige el
              servidor (`assertIdentity`), así que el formulario cambia con el tipo. */}
          {form.clientType === 'PERSON' ? (
            <>
              <Field label={t('form.firstName')}>
                <Input value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} disabled={disabled} required />
              </Field>
              <Field label={t('form.lastName')}>
                <Input value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} disabled={disabled} required />
              </Field>
            </>
          ) : (
            <Field label={t('form.businessName')}>
              <Input value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} disabled={disabled} required />
            </Field>
          )}

          <Field label={t('fields.risk')}>
            <Input value={form.riskSegment} onChange={(e) => set({ riskSegment: e.target.value })} disabled={disabled} />
          </Field>

          <Field label={t('form.status')}>
            <select
              value={form.status}
              onChange={(e) => set({ status: e.target.value as ClienteForm['status'] })}
              disabled={disabled}
              className={select}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`clientStatus.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card title={t('sections.contacts')} onAdd={disabled ? undefined : () => set({ contacts: [...form.contacts, emptyContact(newId())] })} addLabel={t('form.addContact')}>
        <ContactRows rows={form.contacts} onChange={(contacts) => set({ contacts })} disabled={disabled} />
      </Card>

      <Card title={t('sections.locations')} onAdd={disabled ? undefined : () => set({ locations: [...form.locations, emptyLocation(newId())] })} addLabel={t('form.addLocation')}>
        <LocationRows rows={form.locations} onChange={(locations) => set({ locations })} disabled={disabled} />
      </Card>

      <Card title={t('sections.guarantors')} onAdd={disabled ? undefined : () => set({ relations: [...form.relations, emptyRelation(newId())] })} addLabel={t('form.addRelation')}>
        {form.relations.length === 0 && <p className="text-[14px] text-k-muted">{t('noGuarantors')}</p>}
        <div className="space-y-4">
          {form.relations.map((r, i) => (
            <RelationFields
              key={r.id}
              row={r}
              disabled={disabled}
              onChange={(next) => set({ relations: replaceAt(form.relations, i, next) })}
              onRemove={() => set({ relations: form.relations.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ContactRows({
  rows,
  onChange,
  disabled,
}: {
  rows: ContactRow[];
  onChange: (rows: ContactRow[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  if (rows.length === 0) return <p className="text-[14px] text-k-muted">{t('noContacts')}</p>;

  return (
    <ul className="space-y-3">
      {rows.map((c, i) => {
        const set = (patch: Partial<ContactRow>) => onChange(replaceAt(rows, i, { ...c, ...patch }));
        return (
          <li key={c.id} className="grid gap-3 sm:grid-cols-[140px,1fr,auto]">
            <select value={c.contactType} onChange={(e) => set({ contactType: e.target.value as ContactRow['contactType'] })} disabled={disabled} className={select} aria-label={t('form.contactType')}>
              {CONTACT_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`contactType.${v}`)}
                </option>
              ))}
            </select>
            <Input value={c.value} onChange={(e) => set({ value: e.target.value })} disabled={disabled} placeholder={t('form.contactPlaceholder')} aria-label={t('form.contactValue')} />
            <div className="flex items-center gap-4">
              {/* WhatsApp es un `ContactType` propio en el servidor; acá es un switch porque
                  para quien carga es el mismo número. */}
              {c.contactType === 'PHONE' && (
                <Check label="WhatsApp" checked={c.hasWhatsApp} disabled={disabled} onChange={(hasWhatsApp) => set({ hasWhatsApp })} />
              )}
              <Check
                label={t('primary')}
                checked={c.isPrimary}
                disabled={disabled}
                // Principal hay uno solo: marcar uno desmarca al resto.
                onChange={(isPrimary) =>
                  onChange(isPrimary ? rows.map((row, j) => ({ ...row, isPrimary: j === i })) : replaceAt(rows, i, { ...c, isPrimary: false }))
                }
              />
              <RemoveButton onClick={() => onChange(rows.filter((_, j) => j !== i))} disabled={disabled} label={t('form.remove')} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function LocationRows({
  rows,
  onChange,
  disabled,
}: {
  rows: LocationRow[];
  onChange: (rows: LocationRow[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  if (rows.length === 0) return <p className="text-[14px] text-k-muted">{t('noLocations')}</p>;

  return (
    <ul className="space-y-5">
      {rows.map((l, i) => {
        const set = (patch: Partial<LocationRow>) => onChange(replaceAt(rows, i, { ...l, ...patch }));
        return (
          <li key={l.id} className="grid gap-3 sm:grid-cols-2">
            <select value={l.locationType} onChange={(e) => set({ locationType: e.target.value as LocationRow['locationType'] })} disabled={disabled} className={select} aria-label={t('form.locationType')}>
              {LOCATION_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`locationType.${v}`)}
                </option>
              ))}
            </select>
            <Input value={l.zone} onChange={(e) => set({ zone: e.target.value })} disabled={disabled} placeholder={t('form.zone')} aria-label={t('form.zone')} />
            <div className="sm:col-span-2">
              <Input value={l.address} onChange={(e) => set({ address: e.target.value })} disabled={disabled} placeholder={t('form.address')} aria-label={t('form.address')} />
            </div>
            <div className="sm:col-span-2">
              <Input value={l.referenceNotes} onChange={(e) => set({ referenceNotes: e.target.value })} disabled={disabled} placeholder={t('form.reference')} aria-label={t('form.reference')} />
            </div>
            {/* Las coordenadas se tipean. Marcarlas en un mapa es de W6, que es donde entra
                MapLibre; pintar un mapa acá sería traer la librería por un campo. */}
            <Input value={l.latitude} onChange={(e) => set({ latitude: e.target.value })} disabled={disabled} placeholder={t('form.latitude')} aria-label={t('form.latitude')} inputMode="decimal" />
            <Input value={l.longitude} onChange={(e) => set({ longitude: e.target.value })} disabled={disabled} placeholder={t('form.longitude')} aria-label={t('form.longitude')} inputMode="decimal" />
            <div className="sm:col-span-2">
              <RemoveButton onClick={() => onChange(rows.filter((_, j) => j !== i))} disabled={disabled} label={t('form.removeLocation')} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RelationFields({
  row,
  onChange,
  onRemove,
  disabled,
}: {
  row: RelationRow;
  onChange: (next: RelationRow) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<RelationRow>) => onChange({ ...row, ...patch });

  return (
    <div className="rounded-xl border border-k-border bg-k-bg p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input value={row.relatedName} onChange={(e) => set({ relatedName: e.target.value })} disabled={disabled} placeholder={t('form.relatedName')} aria-label={t('form.relatedName')} />
        <select value={row.relationshipType} onChange={(e) => set({ relationshipType: e.target.value as RelationRow['relationshipType'] })} disabled={disabled} className={select} aria-label={t('form.relationType')}>
          {RELATION_TYPES.map((v) => (
            <option key={v} value={v}>
              {t(`relationType.${v}`)}
            </option>
          ))}
        </select>
        <div className="sm:col-span-2">
          <Input value={row.notes} onChange={(e) => set({ notes: e.target.value })} disabled={disabled} placeholder={t('form.notes')} aria-label={t('form.notes')} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Check label={t('form.contactable')} checked={row.isContactable} disabled={disabled} onChange={(isContactable) => set({ isContactable })} />
        <RemoveButton onClick={onRemove} disabled={disabled} label={t('form.removeRelation')} />
      </div>

      <div className="mt-4 space-y-4 border-t border-k-border pt-4">
        <Sub title={t('form.relationContacts')} onAdd={disabled ? undefined : () => set({ contacts: [...row.contacts, emptyContact(newId())] })} addLabel={t('form.addContact')}>
          <ContactRows rows={row.contacts} onChange={(contacts) => set({ contacts })} disabled={disabled} />
        </Sub>
        <Sub title={t('form.relationLocations')} onAdd={disabled ? undefined : () => set({ locations: [...row.locations, emptyLocation(newId())] })} addLabel={t('form.addLocation')}>
          <LocationRows rows={row.locations} onChange={(locations) => set({ locations })} disabled={disabled} />
        </Sub>
      </div>
    </div>
  );
}

function Card({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-k-border bg-white p-5">
      <Sub title={title} onAdd={onAdd} addLabel={addLabel}>
        {children}
      </Sub>
    </section>
  );
}

function Sub({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: ReactNode }) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-k-navy">{title}</h2>
        {onAdd && (
          <button type="button" onClick={onAdd} className="text-[13px] font-medium text-k-purple hover:underline">
            {addLabel}
          </button>
        )}
      </div>
      {children}
    </>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 whitespace-nowrap text-[13px] text-k-text-2">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-k-purple" />
      {label}
    </label>
  );
}

function RemoveButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <button type="button" onClick={onClick} className="text-[13px] font-medium text-k-danger hover:underline">
      {label}
    </button>
  );
}

function replaceAt<T>(rows: T[], i: number, row: T): T[] {
  return rows.map((r, j) => (j === i ? row : r));
}
