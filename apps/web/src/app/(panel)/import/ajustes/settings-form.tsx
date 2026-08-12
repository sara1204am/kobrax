'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  soleAssignee,
  type AbsentRule,
  type ConfigScreen,
  type ImportConfig,
  type ImportConfigPatch,
  type ProfileKind,
  type ScopeKind,
} from '@kobrax/shared';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { Card, Hint } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { scopeRefName } from '@/lib/import';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

const PROFILE_KINDS: ProfileKind[] = ['rows', 'pdf-rows', 'pdf-blocks'];
const SCOPE_KINDS: ScopeKind[] = ['official', 'branch', 'account'];
const ABSENT_RULES: AbsentRule[] = ['set-current', 'no-touch', 'ask'];

/**
 * Ajustes del import.
 *
 * **Guarda al momento**, un `PATCH` por cambio: son siete decisiones sueltas y sin relación entre
 * sí, no un formulario que se manda entero. Y los 7 invariantes los valida el servidor, así que
 * la config que vuelve del `PATCH` es la que manda — no la que la pantalla creía tener. Eso es lo
 * que hace que cambiar la forma del archivo borre el emparejado sin que acá haya una sola línea
 * que lo sepa.
 */
export function SettingsForm({ screen }: { screen: ConfigScreen }) {
  const t = useTranslations('panel.import');
  const locale = useLocale();
  const toast = useToast();

  const [config, setConfig] = useState<ImportConfig>(screen.config);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [askReset, setAskReset] = useState(false);
  /*
   * El TIPO de alcance se elige antes de tener a quién, así que vive un rato acá y no en la
   * config: `official` y `branch` **exigen** un `ref` y el servidor rechaza el par incompleto
   * (`IMPORT_NOT_CONFIGURED`). Guardando en cada cambio, elegir «Un oficial» rebotaba, el select
   * volvía a «Empresa» y el selector de persona —que se dibuja según el tipo— no aparecía nunca:
   * el alcance por oficial o por agencia era **inalcanzable** desde el panel.
   */
  const [scopeKind, setScopeKind] = useState<ScopeKind>(screen.config.scope.kind);

  async function save(patch: ImportConfigPatch) {
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<{ config: ImportConfig }>('/api/imports/config', patch, 'PATCH');
    setSaving(false);
    if (!ok || !data.config) {
      setError(errorText(data.error, t, locale));
      return;
    }
    setConfig(data.config);
    setScopeKind(data.config.scope.kind);
    toast(t('settings.saved'));
  }

  const refOptions = scopeKind === 'official' ? screen.members : screen.branches;
  // El ref guardado sólo vale si es del mismo tipo que se está eligiendo ahora: una persona no
  // sirve de agencia.
  const refValue = config.scope.kind === scopeKind ? (config.scope.ref ?? '') : '';
  const sole = soleAssignee(screen.members);

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      <Card>
        <Field label={t('settings.source')}>
          <Select
            value={config.source}
            disabled={saving}
            onChange={(e) => save({ source: e.target.value as ImportConfig['source'] })}
          >
            <option value="file">{t('settings.sourceFile')}</option>
            <option value="manual">{t('settings.sourceManual')}</option>
          </Select>
        </Field>
        <Hint>{t('settings.sourceManualHint')}</Hint>
      </Card>

      {/* Con la carga a mano el import no existe para esta empresa: no hay nada más que decidir. */}
      {config.source === 'file' && (
        <>
          <Card>
            <Field label={t('settings.scope')}>
              <Select
                value={scopeKind}
                disabled={saving}
                onChange={(e) => {
                  const kind = e.target.value as ScopeKind;
                  setScopeKind(kind);
                  // «Toda la empresa» ya está completo y se guarda al toque. Los otros dos esperan
                  // a que se elija a quién: el par incompleto lo rechaza el servidor.
                  if (kind === 'account') void save({ scope: { kind, ref: null } });
                }}
              >
                {SCOPE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`scopes.${kind}.label`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Hint>{t(`scopes.${scopeKind}.hint`)}</Hint>

            {scopeKind !== 'account' && (
              <div className="mt-4">
                <Field label={t(`scopes.${scopeKind}.refTitle`)}>
                  <Select
                    value={refValue}
                    disabled={saving}
                    onChange={(e) =>
                      e.target.value && save({ scope: { kind: scopeKind, ref: e.target.value } })
                    }
                  >
                    <option value="">{t('settings.scopeRefMissing')}</option>
                    {refOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Hint>
                  {(refValue && scopeRefName(config.scope, screen.members, screen.branches, t)) ||
                    t('settings.scopeHint')}
                </Hint>
              </div>
            )}

            {/* Empresa + una sola persona activa = la cartera se autoasigna y no hay reparto. */}
            {scopeKind === 'account' && sole && <Hint>{t('settings.scopeSole', { name: sole.name })}</Hint>}
          </Card>

          <Card>
            <Field label={t('settings.shape')}>
              <Select
                value={config.profile.kind}
                disabled={saving}
                onChange={(e) => save({ profile: { kind: e.target.value as ProfileKind } })}
              >
                {PROFILE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`profiles.${kind}.label`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Hint>{t(`profiles.${config.profile.kind}.hint`)}</Hint>
            <Hint>{t('settings.shapeWarning')}</Hint>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-k-border pt-5">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-k-text">{t('settings.columns')}</p>
                <p className="mt-1 text-[13px] text-k-text-2">{t('settings.columnsHint')}</p>
              </div>
              <Link
                href="/import/ajustes/columnas"
                className="min-h-[40px] shrink-0 rounded-xl border border-k-border px-4 py-2 text-[14px] font-medium text-k-text-2 hover:bg-k-bg"
              >
                {t('settings.columnsCta')}
              </Link>
            </div>
          </Card>

          <Card>
            <Field label={t('settings.absent')}>
              <Select
                value={config.absentRule}
                disabled={saving}
                onChange={(e) => save({ absentRule: e.target.value as AbsentRule })}
              >
                {ABSENT_RULES.map((rule) => (
                  <option key={rule} value={rule}>
                    {t(`absent.${rule}.label`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Hint>{t(`absent.${config.absentRule}.hint`)}</Hint>
          </Card>

          <Card>
            <Switch
              label={t('settings.carriesAssignee')}
              hint={t('settings.carriesAssigneeHint')}
              checked={config.carriesAssignee}
              disabled={saving}
              onChange={(carriesAssignee) => save({ carriesAssignee })}
            />
            <div className="mt-5 border-t border-k-border pt-5">
              {/*
                Es una regla del móvil, pero es config DEL TENANT y la administra la supervisora
                desde la oficina. El subtítulo dice de quién es, que es más honesto que esconderla.
              */}
              <Switch
                label={t('settings.askOnLogin')}
                hint={t('settings.askOnLoginHint')}
                checked={config.askOnLogin}
                disabled={saving}
                onChange={(askOnLogin) => save({ askOnLogin })}
              />
            </div>
          </Card>
        </>
      )}

      <div className="flex justify-end">
        <span className="w-full sm:w-auto">
          <Button variant="ghost" onClick={() => setAskReset(true)} disabled={saving} className="sm:px-5">
            {t('settings.reset')}
          </Button>
        </span>
      </div>

      <Modal
        open={askReset}
        onClose={() => setAskReset(false)}
        title={t('settings.resetTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAskReset(false)} className="sm:w-auto sm:px-5">
              {t('settings.cancel')}
            </Button>
            <Button
              onClick={() => {
                setAskReset(false);
                void save({ reset: true });
              }}
              className="sm:w-auto sm:px-5"
            >
              {t('settings.resetCta')}
            </Button>
          </>
        }
      >
        {t('settings.resetText')}
      </Modal>
    </div>
  );
}

/** Casilla nativa con su rótulo y su bajada, en una fila. */
function Switch({
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
