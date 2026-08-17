'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  PHONE_PATTERN,
  SUPPORTED_CURRENCIES,
  emptyCollateral,
  emptyContact,
  emptyLocation,
  emptyRelation,
  locationTypeChoices,
  type ClienteForm,
  type CollateralRow,
  type ContactRow,
  type CreditOption,
  type LocationRow,
  type RelationRow,
} from '@kobrax/shared';
import { Field, Input, Select } from '@/components/ui';

const CONTACT_TYPES = ['PHONE', 'EMAIL'] as const;
// Los tipos de dirección salen de `shared` (`locationTypeChoices`): la regla de cuáles se ofrecen es
// la misma acá y en el móvil, y escrita dos veces se separa la primera vez que cambia una.
const RELATION_TYPES = ['GUARANTOR', 'FAMILY', 'COWORKER', 'NEIGHBOR', 'OTHER'] as const;
/** El género es una columna suelta de texto en la base; el móvil usa estas mismas tres letras. */
const GENDERS = [{ value: '' }, { value: 'M' }, { value: 'F' }, { value: 'O' }] as const;
const STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
const CURRENCIES = Object.keys(SUPPORTED_CURRENCIES);

/** Un código de catálogo con su rótulo en el idioma del tenant. */
export interface CatalogOption {
  code: string;
  label: string;
}

/** Id de una fila nueva. Sólo vive en el navegador: la fila sin `serverId` es la que se crea. */
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `r${Date.now()}${Math.random()}`);

function replaceAt<T>(rows: T[], i: number, row: T): T[] {
  return rows.map((r, j) => (j === i ? row : r));
}

/**
 * Los campos del cliente, **agrupados por la misma sección que muestra la ficha**.
 *
 * 🔴 **Cada grupo se exporta por separado, y ésa es la pieza central del flujo nuevo.** La ficha
 * edita de a una sección —el garante se corrige desde el bloque de garantes, no desde un formulario
 * de nueve cajas— y el alta los apila en un acordeón. Los dos usan estos mismos componentes: es lo
 * que hace que ver, corregir y dar de alta se sientan la misma pantalla y no tres productos.
 *
 * Las filas de teléfono y dirección se reusan **tal cual** dentro de cada garante: en el modelo son
 * las mismas tablas, colgadas del garante por `relationId`.
 *
 * Acá sólo se pinta. Qué se manda y qué cambió lo deciden `buildClientePayload` y `diffCliente`, en
 * `shared`.
 */
export function IdentityFields({
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
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label={t('form.clientType')}>
        <Select
          value={form.clientType}
          onChange={(e) => set({ clientType: e.target.value as ClienteForm['clientType'] })}
          disabled={disabled}
        >
          <option value="PERSON">{t('clientType.PERSON')}</option>
          <option value="COMPANY">{t('clientType.COMPANY')}</option>
        </Select>
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

      {/*
       * 🔴 **El género faltaba, y el formulario lo venía cargando igual.**
       *
       * `hydrateCliente` lo trae del server y `buildClientePayload` lo devuelve, así que el dato
       * viajaba de ida y vuelta **sin que nadie pudiera verlo ni corregirlo**: un cliente
       * cargado con el género mal desde el móvil no tenía forma de arreglarse desde el panel.
       */}
      {form.clientType === 'PERSON' && (
        <Field label={t('form.gender')}>
          <Select value={form.gender} onChange={(e) => set({ gender: e.target.value })} disabled={disabled}>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.value ? t(`gender.${g.value}`) : t('gender.unset')}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label={t('fields.risk')}>
        <Input value={form.riskSegment} onChange={(e) => set({ riskSegment: e.target.value })} disabled={disabled} />
      </Field>

      <Field label={t('form.status')}>
        <Select
          value={form.status}
          onChange={(e) => set({ status: e.target.value as ClienteForm['status'] })}
          disabled={disabled}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`clientStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function ContactRows({
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
    /*
     * 🔴 **Cada teléfono en su propia tarjeta, con etiquetas visibles.**
     *
     * Antes eran tres controles pegados en una fila, sin más rótulo que el `placeholder` — que
     * desaparece apenas se escribe. Con cuatro teléfonos cargados, la sección era una grilla de
     * cajas sin nombre donde no se sabía cuál era cuál. Ocupa más alto y se lee.
     */
    <ul className="space-y-3">
      {rows.map((c, i) => {
        const set = (patch: Partial<ContactRow>) => onChange(replaceAt(rows, i, { ...c, ...patch }));
        const esMail = c.contactType === 'EMAIL';
        return (
          <li key={c.id} className="rounded-xl border border-k-border bg-k-bg p-4">
            <div className="grid gap-4 sm:grid-cols-[160px,1fr]">
              <Field label={t('form.contactType')}>
                <Select value={c.contactType} onChange={(e) => set({ contactType: e.target.value as ContactRow['contactType'] })} disabled={disabled}>
                  {CONTACT_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {t(`contactType.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('form.contactValue')}>
                {/*
                 * 🔴 **El navegador valida la forma, y no lo hacía nadie.**
                 *
                 * `type=tel` + `pattern` para el teléfono, `type=email` para el correo: los dos
                 * frenan el submit con el mensaje del sistema, en el idioma del sistema y al lado
                 * del campo. Sin esto, «no me acuerdo» entraba como teléfono y el día de la
                 * cobranza no había a qué llamar. La forma vive en `shared` porque es la misma que
                 * ya valida el móvil y la que evita el 400 del servidor.
                 */}
                <Input
                  value={c.value}
                  onChange={(e) => set({ value: e.target.value })}
                  disabled={disabled}
                  type={esMail ? 'email' : 'tel'}
                  {...(esMail ? {} : { pattern: PHONE_PATTERN, maxLength: 32 })}
                  title={esMail ? undefined : t('form.phoneHint')}
                  placeholder={t('form.contactPlaceholder')}
                />
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-5">
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
              </div>
              <RemoveButton onClick={() => onChange(rows.filter((_, j) => j !== i))} disabled={disabled} label={t('form.remove')} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function LocationRows({
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
    // Ídem los teléfonos: cada dirección en su tarjeta y con etiquetas. Son seis campos —tipo,
    // zona, calle, referencia y dos coordenadas—: apretados en una grilla sin rótulos, no se sabe
    // cuál es la latitud y cuál la longitud hasta escribir en la equivocada.
    <ul className="space-y-3">
      {rows.map((l, i) => {
        const set = (patch: Partial<LocationRow>) => onChange(replaceAt(rows, i, { ...l, ...patch }));
        return (
          <li key={l.id} className="rounded-xl border border-k-border bg-k-bg p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('form.locationType')}>
                <Select value={l.locationType} onChange={(e) => set({ locationType: e.target.value as LocationRow['locationType'] })} disabled={disabled}>
                  {locationTypeChoices(l.locationType).map((v) => (
                    <option key={v} value={v}>
                      {t(`locationType.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('form.zone')}>
                <Input value={l.zone} onChange={(e) => set({ zone: e.target.value })} disabled={disabled} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t('form.address')}>
                  <Input value={l.address} onChange={(e) => set({ address: e.target.value })} disabled={disabled} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={t('form.reference')}>
                  <Input value={l.referenceNotes} onChange={(e) => set({ referenceNotes: e.target.value })} disabled={disabled} />
                </Field>
              </div>
              {/* Las coordenadas se tipean. Marcarlas en un mapa es de W6, que es donde entra
                  MapLibre; pintar un mapa acá sería traer la librería por un campo. */}
              <Field label={t('form.latitude')}>
                <Input
                  value={l.latitude}
                  onChange={(e) => set({ latitude: e.target.value })}
                  disabled={disabled}
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                />
              </Field>
              <Field label={t('form.longitude')}>
                <Input
                  value={l.longitude}
                  onChange={(e) => set({ longitude: e.target.value })}
                  disabled={disabled}
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                />
              </Field>
            </div>
            <div className="mt-3 flex justify-end">
              <RemoveButton onClick={() => onChange(rows.filter((_, j) => j !== i))} disabled={disabled} label={t('form.removeLocation')} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function GuarantorRows({
  rows,
  onChange,
  credits,
  disabled,
}: {
  rows: RelationRow[];
  onChange: (rows: RelationRow[]) => void;
  credits: CreditOption[];
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  if (rows.length === 0) return <p className="text-[13px] text-k-muted">{t('noGuarantors')}</p>;

  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <RelationFields
          key={r.id}
          row={r}
          credits={credits}
          disabled={disabled}
          onChange={(next) => onChange(replaceAt(rows, i, next))}
          onRemove={() => onChange(rows.filter((_, j) => j !== i))}
        />
      ))}
    </div>
  );
}

export function CollateralRows({
  rows,
  onChange,
  credits,
  types,
  currency,
  disabled,
}: {
  rows: CollateralRow[];
  onChange: (rows: CollateralRow[]) => void;
  credits: CreditOption[];
  types: CatalogOption[];
  /** La moneda de la cuenta (`account.currencyCode`): con qué arranca el desplegable. */
  currency: string;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  if (rows.length === 0) return <p className="text-[13px] text-k-muted">{t('noCollaterals')}</p>;

  return (
    <div className="space-y-4">
      {rows.map((g, i) => (
        <CollateralFields
          key={g.id}
          row={g}
          credits={credits}
          types={types}
          currency={currency}
          disabled={disabled}
          onChange={(next) => onChange(replaceAt(rows, i, next))}
          onRemove={() => onChange(rows.filter((_, j) => j !== i))}
        />
      ))}
    </div>
  );
}

/** Las filas nuevas que agrega cada sección. Exportado porque el botón «+ Agregar» vive afuera. */
export const nuevaFila = {
  contact: () => emptyContact(newId()),
  location: () => emptyLocation(newId()),
  relation: () => emptyRelation(newId()),
  collateral: () => emptyCollateral(newId()),
};

/**
 * El formulario completo, en acordeón — **el alta**.
 *
 * Es el mismo formulario que edita la ficha, apilado: al dar de alta no hay una ficha todavía contra
 * la cual editar de a una sección, así que las cinco van juntas. Plegadas, porque lo único
 * obligatorio es la identificación y el resto se carga cuando se tiene: un formulario que abre con
 * treinta campos a la vista se abandona antes de empezar.
 */
export function ClientFormFields({
  form,
  onChange,
  disabled,
  credits = [],
  collateralTypes = [],
  currency,
}: {
  form: ClienteForm;
  onChange: (next: ClienteForm) => void;
  disabled?: boolean;
  /**
   * Los créditos de este cliente, para poder decir a cuál respalda cada garante y cada garantía.
   *
   * Vacío en el ALTA, y está bien: el crédito se carga después, desde la ficha. El garante se guarda
   * igual y el vínculo se arma al editar — al revés (exigir el crédito para cargar al garante) no se
   * podría dar de alta a nadie.
   */
  credits?: CreditOption[];
  /** Catálogo `COLLATERAL_TYPE` del tenant. Vacío = el tipo se escribe libre. */
  collateralTypes?: CatalogOption[];
  currency: string;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<ClienteForm>) => onChange({ ...form, ...patch });

  return (
    <div className="space-y-3">
      <Acordeon title={t('sections.identity')} open>
        <IdentityFields form={form} onChange={onChange} disabled={disabled} />
      </Acordeon>

      <Acordeon
        title={t('sections.contacts')}
        count={form.contacts.length}
        onAdd={disabled ? undefined : () => set({ contacts: [...form.contacts, nuevaFila.contact()] })}
        addLabel={t('form.addContact')}
      >
        <ContactRows rows={form.contacts} onChange={(contacts) => set({ contacts })} disabled={disabled} />
      </Acordeon>

      <Acordeon
        title={t('sections.locations')}
        count={form.locations.length}
        onAdd={disabled ? undefined : () => set({ locations: [...form.locations, nuevaFila.location()] })}
        addLabel={t('form.addLocation')}
      >
        <LocationRows rows={form.locations} onChange={(locations) => set({ locations })} disabled={disabled} />
      </Acordeon>

      <Acordeon
        title={t('sections.guarantors')}
        count={form.relations.length}
        onAdd={disabled ? undefined : () => set({ relations: [...form.relations, nuevaFila.relation()] })}
        addLabel={t('form.addRelation')}
      >
        <GuarantorRows rows={form.relations} onChange={(relations) => set({ relations })} credits={credits} disabled={disabled} />
      </Acordeon>

      <Acordeon
        title={t('sections.collaterals')}
        count={form.collaterals.length}
        onAdd={disabled ? undefined : () => set({ collaterals: [...form.collaterals, nuevaFila.collateral()] })}
        addLabel={t('form.addCollateral')}
      >
        <CollateralRows
          rows={form.collaterals}
          onChange={(collaterals) => set({ collaterals })}
          credits={credits}
          types={collateralTypes}
          currency={currency}
          disabled={disabled}
        />
      </Acordeon>
    </div>
  );
}

/**
 * A qué créditos aplica esta persona o este bien.
 *
 * 🔴 **Checkboxes, no un `<select multiple>`**: el múltiple nativo se opera con Ctrl+clic y pierde
 * toda la selección con un clic distraído. Son dos o tres créditos: entran en una lista.
 *
 * Sin créditos no se dibuja nada y se dice por qué. Un bloque vacío haría pensar que el cliente no
 * tiene deuda, cuando lo que pasa es que todavía no se cargó ninguna.
 */
function CreditPicker({
  credits,
  selected,
  onChange,
  disabled,
}: {
  credits: CreditOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  const format = useFormatter();
  if (credits.length === 0) return <p className="text-[13px] text-k-muted">{t('form.noCreditsYet')}</p>;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {credits.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-[13px] text-k-text">
          <input
            type="checkbox"
            checked={selected.includes(c.id)}
            onChange={() => toggle(c.id)}
            disabled={disabled}
            className="h-4 w-4 accent-k-purple"
          />
          {/* El código no alcanza para distinguirlos: dos créditos del mismo deudor se parecen, y
              el saldo es lo que la persona reconoce. */}
          <span>
            {c.code || t('form.creditNoCode')} · {format.number(c.outstandingBalance, { style: 'currency', currency: c.currency })}
          </span>
        </label>
      ))}
    </div>
  );
}

function CollateralFields({
  row,
  credits,
  types,
  currency,
  onChange,
  onRemove,
  disabled,
}: {
  row: CollateralRow;
  credits: CreditOption[];
  types: CatalogOption[];
  currency: string;
  onChange: (next: CollateralRow) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<CollateralRow>) => onChange({ ...row, ...patch });
  /*
   * 🔴 **Un tipo guardado que ya no está en el catálogo sigue apareciendo**, igual que en las
   * direcciones (`locationTypeChoices`). Sin esto, abrir la garantía la re-etiquetaría con la primera
   * opción de la lista y guardar pisaría el dato sin que nadie tocara ese campo.
   */
  const opciones = row.type && !types.some((c) => c.code === row.type)
    ? [...types, { code: row.type, label: row.type }]
    : types;
  // Ídem para la moneda: una fila guardada en una moneda que ya no ofrecemos no se re-etiqueta sola.
  const monedas = row.currency && !CURRENCIES.includes(row.currency) ? [...CURRENCIES, row.currency] : CURRENCIES;

  return (
    <div className="rounded-xl border border-k-border bg-k-bg p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Con catálogo cargado, desplegable; sin catálogo, texto libre. Un `<select>` vacío sería
            un campo que no se puede llenar, y el catálogo del tenant arranca vacío. */}
        <Field label={t('form.collateralType')}>
          {opciones.length > 0 ? (
            <Select value={row.type} onChange={(e) => set({ type: e.target.value })} disabled={disabled}>
              <option value="">{t('form.collateralTypeUnset')}</option>
              {opciones.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label || c.code}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={row.type} onChange={(e) => set({ type: e.target.value })} disabled={disabled} maxLength={64} />
          )}
        </Field>
        <div className="sm:col-span-2">
          {/* La descripción es lo que hace existir a la garantía (`hasCollateralData`): sin ella la
              fila se descarta en silencio. Por eso es `required` y lo dice el rótulo. */}
          <Field label={t('form.collateralDescription')}>
            <Input
              value={row.description}
              onChange={(e) => set({ description: e.target.value })}
              disabled={disabled}
              maxLength={500}
              required
            />
          </Field>
        </div>
        <Field label={t('form.collateralValue')}>
          {/*
           * 🔴 **Número de verdad, no texto que se parsea al final.** Como texto, `7.000,50` se
           * convertía en `NaN`, se mandaba `undefined` y la garantía se guardaba **sin valor**, con
           * un «Guardado» verde arriba. Con `type=number` el navegador no deja escribir eso, y el
           * `min=0` frena acá el mismo 400 que devuelve el `@Min(0)` del servidor.
           */}
          <Input
            value={row.estimatedValue}
            onChange={(e) => set({ estimatedValue: e.target.value })}
            disabled={disabled}
            type="number"
            min={0}
            step="0.01"
          />
        </Field>
        <Field label={t('form.collateralCurrency')}>
          {/*
           * 🔴 **Desplegable y no tres letras a mano.** Escrito libre, «Bs» era lo natural y lo que
           * el servidor rechaza con un `@Length(3,3)` en inglés arriba de todo el formulario. Arranca
           * en la moneda de la cuenta —la de Configuración— porque es en la que opera la empresa; las
           * otras están para el préstamo en dólares, que existe.
           */}
          <Select
            value={row.currency || currency}
            onChange={(e) => set({ currency: e.target.value })}
            disabled={disabled}
          >
            {monedas.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-4 border-t border-k-border pt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('form.appliesTo')}</p>
        <CreditPicker credits={credits} selected={row.creditIds} onChange={(creditIds) => set({ creditIds })} disabled={disabled} />
      </div>

      <div className="mt-3 flex justify-end">
        <RemoveButton onClick={onRemove} disabled={disabled} label={t('form.removeCollateral')} />
      </div>
    </div>
  );
}

function RelationFields({
  row,
  credits,
  onChange,
  onRemove,
  disabled,
}: {
  row: RelationRow;
  credits: CreditOption[];
  onChange: (next: RelationRow) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<RelationRow>) => onChange({ ...row, ...patch });

  return (
    <div className="rounded-xl border border-k-border bg-k-bg p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('form.relatedName')}>
          <Input value={row.relatedName} onChange={(e) => set({ relatedName: e.target.value })} disabled={disabled} required />
        </Field>
        <Field label={t('form.relationType')}>
          <Select value={row.relationshipType} onChange={(e) => set({ relationshipType: e.target.value as RelationRow['relationshipType'] })} disabled={disabled}>
            {RELATION_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`relationType.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        {/* Ídem el del cliente: se cargaba y se devolvía sin que nadie pudiera corregirlo. */}
        <Field label={t('form.gender')}>
          <Select value={row.gender} onChange={(e) => set({ gender: e.target.value })} disabled={disabled}>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.value ? t(`gender.${g.value}`) : t('gender.unset')}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('form.notes')}>
            <Input value={row.notes} onChange={(e) => set({ notes: e.target.value })} disabled={disabled} />
          </Field>
        </div>
      </div>

      {/* A qué créditos responde. Va acá arriba, junto a quién es, y no al final entre sus
          teléfonos: es lo que distingue a un garante de un contacto cualquiera. */}
      <div className="mt-3 border-t border-k-border pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('form.guarantees')}</p>
        <CreditPicker credits={credits} selected={row.creditIds} onChange={(creditIds) => set({ creditIds })} disabled={disabled} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Check label={t('form.contactable')} checked={row.isContactable} disabled={disabled} onChange={(isContactable) => set({ isContactable })} />
        <RemoveButton onClick={onRemove} disabled={disabled} label={t('form.removeRelation')} />
      </div>

      <div className="mt-4 space-y-4 border-t border-k-border pt-4">
        <Sub title={t('form.relationContacts')} onAdd={disabled ? undefined : () => set({ contacts: [...row.contacts, nuevaFila.contact()] })} addLabel={t('form.addContact')}>
          <ContactRows rows={row.contacts} onChange={(contacts) => set({ contacts })} disabled={disabled} />
        </Sub>
        <Sub title={t('form.relationLocations')} onAdd={disabled ? undefined : () => set({ locations: [...row.locations, nuevaFila.location()] })} addLabel={t('form.addLocation')}>
          <LocationRows rows={row.locations} onChange={(locations) => set({ locations })} disabled={disabled} />
        </Sub>
      </div>
    </div>
  );
}

/**
 * Una sección plegable del alta.
 *
 * 🔴 **`<details>` nativo, sin una línea de JavaScript** — el mismo recurso que usa la lista de
 * créditos. Abrir y cerrar lo hace el navegador, funciona con teclado solo, y **un campo dentro de
 * un `<details>` cerrado sigue participando de la validación del formulario**: si falta el apellido,
 * el navegador abre la sección y lo enfoca en vez de rebotar el submit sin decir dónde.
 *
 * El contador va en el rótulo porque plegado no se ve el contenido: «Garantes (2)» dice que hay algo
 * ahí adentro; «Garantes» a secas invita a abrirlo para descubrir que está vacío.
 */
function Acordeon({
  title,
  count,
  open,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  count?: number;
  open?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group rounded-2xl border border-k-border bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 hover:bg-k-bg [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-k-muted transition-transform group-open:rotate-180">
          ⌄
        </span>
        <span className="flex-1 text-[14px] font-semibold text-k-navy">
          {title}
          {count != null && count > 0 && <span className="ml-1.5 font-normal text-k-muted">({count})</span>}
        </span>
      </summary>
      <div className="border-t border-k-border p-4">
        {onAdd && (
          <div className="mb-3 flex justify-end">
            <button type="button" onClick={onAdd} className="text-[13px] font-medium text-k-periwinkle hover:underline">
              + {addLabel}
            </button>
          </div>
        )}
        {children}
      </div>
    </details>
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
