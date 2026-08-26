'use client';

import { useTranslations } from 'next-intl';
import {
  applyFieldState,
  fieldState,
  type FieldDef,
  type FieldRule,
  type FieldState,
  type ImportConfigPatch,
} from '@kobrax/shared';
import { Select } from '@/components/ui';
import { Badge } from '@/components/panel-ui';
import { fieldStatus, type FieldStatus } from '@/lib/import';

const FIELD_STATES: FieldState[] = ['required', 'optional', 'off'];

/**
 * Un ancla visual para reconocer la fila sin leerla. Un campo sin ícono no dibuja nada: la lista
 * de campos la manda el servidor y va a crecer, y un mapa incompleto acá no puede romper la fila.
 */
const ICONS: Record<string, string> = {
  code: '🔑',
  clientName: '👤',
  clientLastName: '👤',
  clientFirstName: '👤',
  coHolder: '👥',
  outstandingBalance: '💰',
  principalAmount: '💰',
  pastDueAmount: '💰',
  installmentAmount: '💵',
  daysPastDue: '📅',
  disbursedAt: '📅',
  nextDueDate: '📅',
  phone: '📱',
  address: '📍',
  addressRef: '📍',
  branchLabel: '🏢',
};

const TONES: Record<FieldStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ready: 'success',
  review: 'warning',
  missing: 'danger',
  off: 'neutral',
};

/**
 * Una fila del emparejado: qué dato es, de qué columna sale y **qué trae esa columna de verdad**.
 *
 * Los ejemplos son el punto entero de la fila. Sin ellos el control ofrece «SALDO» y «SALDO
 * CAPITAL» y no hay forma de saber cuál es cuál hasta que la cartera entró mal.
 */
export function FieldRow({
  field,
  catalog,
  rule,
  labels,
  samples,
  used,
  busy,
  onSave,
}: {
  field: string;
  catalog: Record<string, FieldDef>;
  rule: FieldRule | undefined;
  /** Las etiquetas que trajo la muestra. */
  labels: string[];
  /** Etiqueta → primeros valores reales del archivo. */
  samples: Record<string, string[]>;
  /** `dónde:etiqueta` → campo que ya la usa. El servidor rechaza repetirla. */
  used: Map<string, string>;
  busy: boolean;
  onSave: (patch: ImportConfigPatch) => void;
}) {
  const t = useTranslations('panel.import');
  const def = catalog[field];
  const status = fieldStatus(field, rule);
  const label = def?.label ?? field;
  const locked = def?.locked ?? false;

  // La columna guardada puede no venir en ESTA muestra (un mes donde está vacía). Se ofrece igual,
  // o cambiar de muestra desemparejaría todo sin decirlo.
  const options = rule?.from && !labels.includes(rule.from) ? [rule.from, ...labels] : labels;
  const values = rule?.from ? samples[rule.from] : undefined;

  return (
    <li className="border-t border-k-border px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[170px] items-center gap-2.5">
          {ICONS[field] && (
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-k-bg text-[15px]"
            >
              {ICONS[field]}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-k-text">{label}</span>
            {locked && <span className="mt-0.5 block text-[12px] text-k-text-2">{t('columns.locked')}</span>}
          </span>
        </div>

        <div className="min-w-0 flex-1 basis-[240px]">
          <Select
            aria-label={`${t('columns.from')} — ${label}`}
            value={rule?.from ?? ''}
            disabled={busy}
            className="h-10 text-[14px]"
            onChange={(e) =>
              onSave({
                // `in` se limpia: las opciones son etiquetas del archivo, no columnas del cuadro, y
                // heredar el `in` anterior manda al motor a buscarlas donde no están.
                fields: { [field]: { ...rule, from: e.target.value || undefined, in: undefined } },
              })
            }
          >
            {/*
              Desemparejar un campo bloqueado pasa las dos validaciones del servidor y deja el
              import sin llave: la corrida siguiente rechaza el 100 % de las filas con `NO_CODE`
              mientras la pantalla se ve entera. La opción se dibuja para que el control tenga qué
              mostrar cuando todavía no hay columna, pero no se puede elegir.
            */}
            <option value="" disabled={locked}>
              {t('columns.notMapped')}
            </option>
            {options.map((option) => {
              // Elegir una columna que ya alimenta otro dato lo rechaza el servidor
              // (`COLUMN_ALREADY_MAPPED`). Se dice acá, antes de gastar el viaje.
              const owner = used.get(`header:${option}`);
              return (
                <option key={option} value={option} disabled={Boolean(owner)}>
                  {owner
                    ? t('columns.takenBy', { column: option, field: catalog[owner]?.label ?? owner })
                    : option}
                </option>
              );
            })}
          </Select>

          {values?.length ? (
            <p className="mt-1.5 truncate text-[12px] text-k-text-2" title={values.join(' · ')}>
              <span className="text-k-muted">{t('columns.examples')} </span>
              {values.join(' · ')}
            </p>
          ) : (
            rule?.from && <p className="mt-1.5 text-[12px] text-k-muted">{t('columns.noExamples')}</p>
          )}
        </div>

        <Badge tone={TONES[status]} dot>
          {t(`columns.rowStatus.${status}`)}
        </Badge>
      </div>

      {/*
        Estado y quitar viven abajo y en chico: se deciden una vez. El control que se usa de verdad
        es el de arriba. Un campo que todavía no se agregó no muestra estado — `fieldState` de una
        regla inexistente da «No importar», que no es lo que pasa: pasa que falta elegir columna.
      */}
      {!locked && rule && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:pl-[42px]">
          <label className="flex items-center gap-2 text-[12px] text-k-text-2">
            {t('columns.state')}
            <Select
              aria-label={`${t('columns.state')} — ${label}`}
              value={fieldState(rule)}
              disabled={busy}
              className="h-8 w-auto text-[13px]"
              onChange={(e) => onSave({ fields: { [field]: applyFieldState(rule, e.target.value as FieldState) } })}
            >
              {FIELD_STATES.map((state) => (
                <option key={state} value={state}>
                  {t(`fieldStates.${state}.label`)}
                </option>
              ))}
            </Select>
          </label>
          {/* `null` QUITA el campo de la lista. «No importar» lo deja adentro, apagado. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave({ fields: { [field]: null } })}
            className="text-[12px] font-medium text-k-text-2 underline hover:text-k-danger disabled:opacity-50"
          >
            {t('columns.remove')}
          </button>
        </div>
      )}
    </li>
  );
}
