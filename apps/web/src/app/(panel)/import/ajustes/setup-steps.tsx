'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  soleAssignee,
  type AbsentRule,
  type ConfigScreen,
  type ImportConfig,
  type ImportConfigPatch,
  type ProfileKind,
  type ScopeKind,
} from '@kobrax/shared';
import { Button, Field, Select } from '@/components/ui';
import { Badge, Card } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { ACCEPTED_FILES, scopeRefName } from '@/lib/import';

const PROFILE_KINDS: ProfileKind[] = ['rows', 'pdf-rows', 'pdf-blocks'];
const SCOPE_KINDS: ScopeKind[] = ['account', 'official', 'branch'];
const ABSENT_RULES: AbsentRule[] = ['set-current', 'no-touch', 'ask'];

/**
 * Un tramo de la configuración, numerado.
 *
 * El número no es decoración: la pantalla tiene un orden que importa —sin saber cómo está
 * organizado el archivo no hay columnas que emparejar— y numerarlo es lo que convierte cuatro
 * tarjetas sueltas en una secuencia.
 */
export function Step({
  n,
  title,
  hint,
  badge,
  blocked,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  badge?: ReactNode;
  /** Por qué todavía no se puede tocar. Un control gris sin motivo es un bug para el usuario. */
  blocked?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-k-border bg-white">
      <header className="flex flex-wrap items-start gap-3 border-b border-k-border px-5 py-4">
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
            blocked ? 'bg-k-bg text-k-muted' : 'bg-k-light-bg text-k-navy'
          }`}
        >
          {n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-k-navy">{title}</h2>
            {badge}
          </span>
          {hint && <span className="mt-0.5 block text-[13px] text-k-text-2">{hint}</span>}
        </span>
      </header>
      {blocked ? (
        <p className="px-5 py-6 text-[13px] text-k-muted">{blocked}</p>
      ) : (
        <div className="px-5 py-5">{children}</div>
      )}
    </section>
  );
}

/**
 * Elegir una opción entre pocas, **con su explicación a la vista**.
 *
 * Un `<select>` esconde las alternativas y su razón: para decidir entre «una fila por crédito» y
 * «un bloque por crédito» hay que poder leer las dos. Es un `radiogroup` de verdad, así que las
 * flechas del teclado lo recorren y un lector de pantalla anuncia «2 de 3, seleccionado».
 */
export function OptionCards<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; title: string; hint: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-3 sm:grid-cols-3">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-xl border p-4 text-left transition-colors disabled:opacity-50 ${
              active
                ? 'border-k-periwinkle bg-k-highlight shadow-k-focus'
                : 'border-k-border bg-white hover:bg-k-bg'
            }`}
          >
            <span className="flex items-start gap-2">
              {/* El punto del radio: el estado no se deduce sólo del fondo. */}
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  active ? 'border-k-purple' : 'border-k-muted'
                }`}
              >
                {active && <span className="h-2 w-2 rounded-full bg-k-purple" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-k-text">{option.title}</span>
                <span className="mt-1 block text-[12px] leading-snug text-k-text-2">{option.hint}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Casilla nativa con su rótulo y su bajada, en una fila. */
export function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-k-purple"
      />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-k-text">{label}</span>
        <span className="mt-1 block text-[13px] text-k-text-2">{hint}</span>
      </span>
    </label>
  );
}

/**
 * El archivo de muestra y **cómo está organizado**, juntos.
 *
 * Van en el mismo tramo porque son la misma pregunta vista de dos lados: el servidor valida la
 * forma contra los bytes (`assertFileShape`) antes de leer nada, así que elegir mal la forma se
 * descubre exactamente acá — al subir. Tenerla en otra pantalla obligaba a ir, cambiarla y volver.
 */
export function SampleStep({
  config,
  fileName,
  columnCount,
  busy,
  reading,
  onPick,
  onProfile,
}: {
  config: ImportConfig;
  fileName: string | null;
  columnCount: number | null;
  busy: boolean;
  reading: boolean;
  onPick: (file: File) => void;
  onProfile: (patch: ImportConfigPatch) => void;
}) {
  const t = useTranslations('panel.import');
  const picker = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState<ProfileKind | null>(null);

  const mapped = Object.values(config.fields).filter((rule) => rule.from).length;

  function pickProfile(kind: ProfileKind) {
    if (kind === config.profile.kind) return;
    // Cambiar la forma BORRA el emparejado del lado del servidor. Antes era un renglón gris de
    // aviso: el mismo daño que el reset, que sí preguntaba. Si no hay nada emparejado no se
    // pregunta — no se pierde nada y preguntar de gusto enseña a decir que sí sin leer.
    if (mapped > 0) setAsk(kind);
    else onProfile({ profile: { kind } });
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-k-text">{t('columns.sample')}</p>
          <p className="mt-1 truncate text-[14px] text-k-text-2">
            {reading ? t('columns.reading') : (fileName ?? t('columns.noSampleText'))}
          </p>
          <p className="mt-2 text-[12px] text-k-muted">
            {columnCount !== null
              ? t('columns.seeDetected', { n: columnCount })
              : t(`profiles.${config.profile.kind}.format`)}
          </p>
        </div>
        <input
          ref={picker}
          type="file"
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // El input se limpia para que elegir el MISMO archivo otra vez vuelva a disparar
            // `change` — si no, reintentar después de un error no hace nada.
            e.target.value = '';
            if (file) onPick(file);
          }}
        />
        <span className="shrink-0">
          <Button variant="ghost" disabled={busy} onClick={() => picker.current?.click()} className="sm:w-auto sm:px-5">
            {fileName ? t('columns.changeSample') : t('columns.pickSample')}
          </Button>
        </span>
      </div>

      <div className="mt-6 border-t border-k-border pt-5">
        <p className="text-[14px] font-medium text-k-text">{t('setup.shapeQuestion')}</p>
        <p className="mt-1 text-[13px] text-k-text-2">{t('setup.shapeHint')}</p>
        <div className="mt-4">
          <OptionCards
            label={t('setup.shapeQuestion')}
            value={config.profile.kind}
            disabled={busy}
            onChange={pickProfile}
            options={PROFILE_KINDS.map((kind) => ({
              value: kind,
              title: t(`profiles.${kind}.label`),
              hint: t(`profiles.${kind}.hint`),
            }))}
          />
        </div>
      </div>

      <Modal
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={t('setup.shapeConfirmTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)} className="sm:w-auto sm:px-5">
              {t('settings.cancel')}
            </Button>
            <Button
              onClick={() => {
                const kind = ask;
                setAsk(null);
                if (kind) onProfile({ profile: { kind } });
              }}
              className="sm:w-auto sm:px-5"
            >
              {t('setup.shapeConfirmCta')}
            </Button>
          </>
        }
      >
        {t('setup.shapeConfirmText', { n: mapped })}
      </Modal>
    </>
  );
}

/**
 * De quién es la cartera que trae el archivo — y por lo tanto **hasta dónde llega el reconcile**.
 *
 * El tipo vive en estado local y no en la config porque `official` y `branch` **exigen** un `ref`:
 * el servidor rechaza el par incompleto (`IMPORT_NOT_CONFIGURED`). Guardando en cada cambio,
 * elegir «Un oficial» rebotaba, el control volvía a «Toda la empresa» y el selector de persona no
 * llegaba a aparecer: el alcance por oficial era inalcanzable desde el panel. Lo que sí cambió es
 * que ahora la espera **se ve** en vez de ser silencio.
 */
export function ScopeStep({
  screen,
  config,
  busy,
  onSave,
}: {
  screen: ConfigScreen;
  config: ImportConfig;
  busy: boolean;
  onSave: (patch: ImportConfigPatch) => void;
}) {
  const t = useTranslations('panel.import');
  const [kind, setKind] = useState<ScopeKind>(config.scope.kind);

  const options = kind === 'official' ? screen.members : screen.branches;
  // El ref guardado sólo vale si es del mismo tipo que se está eligiendo ahora: una persona no
  // sirve de agencia.
  const ref = config.scope.kind === kind ? (config.scope.ref ?? '') : '';
  const sole = soleAssignee(screen.members);
  const pending = kind !== 'account' && !ref;

  return (
    <>
      <OptionCards
        label={t('setup.scopeQuestion')}
        value={kind}
        disabled={busy}
        onChange={(next) => {
          setKind(next);
          // «Toda la empresa» ya está completo y se guarda al toque. Los otros dos esperan a que
          // se elija a quién: el par incompleto lo rechaza el servidor.
          if (next === 'account') onSave({ scope: { kind: next, ref: null } });
        }}
        options={SCOPE_KINDS.map((value) => ({
          value,
          title: t(`scopes.${value}.label`),
          hint: t(`scopes.${value}.hint`),
        }))}
      />

      {kind !== 'account' && (
        <div className="mt-5 max-w-md">
          <Field label={t(`scopes.${kind}.refTitle`)}>
            <Select
              value={ref}
              disabled={busy}
              onChange={(e) => e.target.value && onSave({ scope: { kind, ref: e.target.value } })}
            >
              <option value="">{t('settings.scopeRefMissing')}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          {/* Elegir el tipo sin elegir a quién no se guarda. Antes eso era silencio y parecía
              guardado; ahora lo dice, que es la diferencia entre esperar y estar roto. */}
          <p className={`mt-2 text-[13px] ${pending ? 'text-k-warning-text' : 'text-k-text-2'}`}>
            {pending
              ? t('setup.scopePending')
              : (scopeRefName(config.scope, screen.members, screen.branches, t) ?? t('settings.scopeHint'))}
          </p>
        </div>
      )}

      {/* Empresa + una sola persona activa = la cartera se autoasigna y no hay reparto. */}
      {kind === 'account' && sole && (
        <p className="mt-4 text-[13px] text-k-text-2">{t('settings.scopeSole', { name: sole.name })}</p>
      )}
    </>
  );
}

/** Qué hacer con lo que el archivo no trae, y las dos casillas del reparto. */
export function RulesStep({
  config,
  busy,
  onSave,
}: {
  config: ImportConfig;
  busy: boolean;
  onSave: (patch: ImportConfigPatch) => void;
}) {
  const t = useTranslations('panel.import');

  return (
    <>
      <p className="text-[14px] font-medium text-k-text">{t('settings.absent')}</p>
      <div className="mt-4">
        <OptionCards
          label={t('settings.absent')}
          value={config.absentRule}
          disabled={busy}
          onChange={(absentRule) => onSave({ absentRule })}
          options={ABSENT_RULES.map((rule) => ({
            value: rule,
            title: t(`absent.${rule}.label`),
            hint: t(`absent.${rule}.hint`),
          }))}
        />
      </div>

      <div className="mt-6 space-y-5 border-t border-k-border pt-5">
        <Switch
          label={t('settings.carriesAssignee')}
          hint={t('settings.carriesAssigneeHint')}
          checked={config.carriesAssignee}
          disabled={busy}
          onChange={(carriesAssignee) => onSave({ carriesAssignee })}
        />
        {/*
          Es una regla del móvil, pero es config DEL TENANT y la administra la supervisora desde la
          oficina. El subtítulo dice de quién es, que es más honesto que esconderla.
        */}
        <Switch
          label={t('settings.askOnLogin')}
          hint={t('settings.askOnLoginHint')}
          checked={config.askOnLogin}
          disabled={busy}
          onChange={(askOnLogin) => onSave({ askOnLogin })}
        />
      </div>
    </>
  );
}

/** De dónde sale la cartera. Con «a mano» el import no existe para esta empresa. */
export function SourceCard({
  config,
  busy,
  onSave,
}: {
  config: ImportConfig;
  busy: boolean;
  onSave: (patch: ImportConfigPatch) => void;
}) {
  const t = useTranslations('panel.import');
  const byFile = config.source === 'file';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-medium text-k-text">{t('settings.source')}</p>
            <Badge tone={byFile ? 'success' : 'neutral'} dot>
              {t(byFile ? 'settings.sourceFile' : 'settings.sourceManual')}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-k-text-2">
            {byFile ? t('setup.sourceFileHint') : t('settings.sourceManualHint')}
          </p>
        </div>
        <span className="shrink-0">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onSave({ source: byFile ? 'manual' : 'file' })}
            className="sm:w-auto sm:px-5"
          >
            {t(byFile ? 'setup.sourceToManual' : 'setup.sourceToFile')}
          </Button>
        </span>
      </div>
    </Card>
  );
}
