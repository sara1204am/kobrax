'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ACTIVITY_CHANNELS, PROMISE_RESULT } from '@kobrax/shared';
import { ActivityContextFields, activityContextPayload, emptyActivityContext, type ActivityContext } from '@/components/activity-context-fields';
import type { CatalogOption } from '@/components/client-form';
import { Field, Input, Select } from '@/components/ui';

/** El tipo de la bitácora (`credit_activities.type`): una llamada, una visita, un mensaje o una nota. */
export type OutcomeType = 'CALL' | 'VISIT' | 'MESSAGE' | 'NOTE';

/** Todo lo que se captura al registrar el resultado de una gestión. Texto: vacío = no se eligió. */
export interface OutcomeState {
  /** Llamada o mensaje: a qué teléfono o correo. */
  contactId: string;
  /** Visita: qué dirección se visitó. */
  locationId: string;
  /** Mensaje: por dónde se mandó. */
  channel: string;
  result: string;
  /** Motivo de no pago y fecha esperada: solo cuando se habló con el deudor. */
  ctx: ActivityContext;
  notes: string;
  /** Mensaje: la plantilla que se usó. */
  templateCode: string;
}

export const emptyOutcome = (): OutcomeState => ({ contactId: '', locationId: '', channel: '', result: '', ctx: emptyActivityContext(), notes: '', templateCode: '' });

export interface OutcomeContact {
  id: string;
  value: string;
  isPrimary?: boolean;
}
export interface OutcomeLocation {
  id: string;
  address?: string | null;
  zone?: string | null;
}

/** Los resultados con los que se habló con el deudor: ahí recién tiene sentido preguntar por qué no pagó. */
const TALKED = new Set<string>(['CONTACTED', PROMISE_RESULT]);

/** ¿Se despliega el motivo de no pago? Solo en una gestión con resultado «habló con el deudor» (o prometió pagar) y con catálogo. */
export function showsReason(type: OutcomeType, result: string, reasons: CatalogOption[]): boolean {
  return type !== 'NOTE' && reasons.length > 0 && TALKED.has(result);
}

/**
 * Lo que viaja a la API, **solo lo elegido y solo lo que corresponde al tipo**: la dirección es de una visita; el teléfono, de una llamada
 * o un mensaje; el canal, de un mensaje; el motivo, de cuando se habló con el deudor. La API rechaza lo que no corresponda, así que
 * aquí no se manda.
 */
export function outcomeBody(type: OutcomeType, s: OutcomeState, reasons: CatalogOption[]) {
  return {
    ...(s.result ? { result: s.result } : {}),
    ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
    ...(type === 'VISIT' && s.locationId ? { locationId: s.locationId } : {}),
    ...((type === 'CALL' || type === 'MESSAGE') && s.contactId ? { contactId: s.contactId } : {}),
    ...(type === 'MESSAGE' && s.channel ? { channel: s.channel } : {}),
    ...(type === 'MESSAGE' && s.templateCode ? { templateCode: s.templateCode } : {}),
    ...(showsReason(type, s.result, reasons) ? activityContextPayload(s.ctx, reasons) : {}),
  };
}

/**
 * El cuerpo de «Registrar acción»: **el mismo en la ficha de mora y en la agenda**.
 *
 * Orden: a qué dirección o teléfono y por qué canal → cómo terminó → (solo si se habló con el deudor) por qué no pagó → observaciones.
 * Lo que el alta de la agenda ya pide (teléfono, dirección, plantilla) se pide también al registrar directo en mora: antes solo existía
 * al agendar. Las observaciones siempre están: ahí va todo lo demás.
 */
export function ActivityOutcomeFields({
  type,
  value,
  onChange,
  results,
  resultLabel,
  contacts = [],
  locations = [],
  reasons,
  incomeSource,
  templates = [],
  disabled,
  notesMax = 1000,
  afterResult,
  notesLabel,
  resultLabelText,
  templateLabelText,
}: {
  type: OutcomeType;
  value: OutcomeState;
  onChange: (next: OutcomeState) => void;
  /** Los resultados válidos para este tipo. Una nota no tiene. */
  results: readonly string[];
  resultLabel: (result: string) => string;
  contacts?: OutcomeContact[];
  locations?: OutcomeLocation[];
  reasons: CatalogOption[];
  incomeSource?: string;
  /** Plantillas de mensaje de la cuenta: solo se ofrecen en un mensaje. */
  templates?: CatalogOption[];
  disabled?: boolean;
  notesMax?: number;
  /** Algo que va justo después del resultado (la promesa de pago, en la ficha de mora). */
  afterResult?: React.ReactNode;
  /** Otro rótulo para las observaciones (la agenda usa el suyo). */
  notesLabel?: string;
  /** Otros rótulos para el resultado y la plantilla (la agenda dice «Qué pasó»). */
  resultLabelText?: string;
  templateLabelText?: string;
}) {
  const t = useTranslations('panel.mora.ficha.activity');
  const set = (patch: Partial<OutcomeState>) => onChange({ ...value, ...patch });

  // Arranca con lo habitual: el teléfono principal y, si hay una sola dirección, esa. Solo rellena lo que está vacío.
  useEffect(() => {
    const patch: Partial<OutcomeState> = {};
    if ((type === 'CALL' || type === 'MESSAGE') && !value.contactId && contacts.length > 0) patch.contactId = (contacts.find((c) => c.isPrimary) ?? contacts[0]!).id;
    if (type === 'VISIT' && !value.locationId && locations.length === 1) patch.locationId = locations[0]!.id;
    if (type === 'MESSAGE' && !value.channel) patch.channel = 'WHATSAPP';
    if (Object.keys(patch).length > 0) onChange({ ...value, ...patch });
    // Solo cuando cambia el tipo o llegan los datos del cliente; no en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, contacts, locations]);

  const withContact = type === 'CALL' || type === 'MESSAGE';

  return (
    <div className="space-y-4">
      {type === 'MESSAGE' && (
        <Field label={t('channel')}>
          <Select value={value.channel} onChange={(e) => set({ channel: e.target.value })} disabled={disabled}>
            <option value="">{t('channelPlaceholder')}</option>
            {ACTIVITY_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`channels.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {withContact && (
        <Field label={t('contact')}>
          <Select value={value.contactId} onChange={(e) => set({ contactId: e.target.value })} disabled={disabled || contacts.length === 0}>
            <option value="">{contacts.length === 0 ? t('noContacts') : t('contactPlaceholder')}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.value}
                {c.isPrimary ? ` · ${t('primary')}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {type === 'VISIT' && (
        <Field label={t('location')}>
          <Select value={value.locationId} onChange={(e) => set({ locationId: e.target.value })} disabled={disabled || locations.length === 0}>
            <option value="">{locations.length === 0 ? t('noLocations') : t('locationPlaceholder')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.address, l.zone].filter(Boolean).join(' · ') || '—'}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {type === 'MESSAGE' && templates.length > 0 && (
        <Field label={templateLabelText ?? t('template')}>
          <Select value={value.templateCode} onChange={(e) => set({ templateCode: e.target.value })} disabled={disabled}>
            <option value="">{t('templatePlaceholder')}</option>
            {templates.map((tpl) => (
              <option key={tpl.code} value={tpl.code}>
                {tpl.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {results.length > 0 && (
        <Field label={resultLabelText ?? t('result')} required>
          <Select value={value.result} onChange={(e) => set({ result: e.target.value })} disabled={disabled}>
            <option value="">{t('resultPlaceholder')}</option>
            {results.map((r) => (
              <option key={r} value={r}>
                {resultLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {afterResult}

      {/* Solo si se habló con el deudor: por qué no pagó (y cuándo espera cobrar). Con otro resultado no se pregunta. */}
      {showsReason(type, value.result, reasons) && (
        <ActivityContextFields reasons={reasons} incomeSource={incomeSource} value={value.ctx} onChange={(ctx) => set({ ctx })} disabled={disabled} />
      )}

      <Field label={notesLabel ?? (type === 'NOTE' ? t('noteText') : t('notes'))} required={type === 'NOTE'}>
        <Input value={value.notes} onChange={(e) => set({ notes: e.target.value })} disabled={disabled} maxLength={notesMax} />
      </Field>
    </div>
  );
}
