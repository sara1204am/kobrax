'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { diffProfile, hasChanges, type MyProfile, type ProfileForm as Form } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { ImageUploadField } from '@/components/image-upload-field';
import { Section } from '@/components/panel-ui';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { useSaveSection } from '../../cuenta/save-bar';
import { QrViewer } from './qr-viewer';

const formOf = (p: MyProfile): Form => ({
  firstName: p.firstName ?? '',
  lastName: p.lastName ?? '',
  phone: p.phone ?? '',
  photoUrl: p.photoUrl ?? '',
  paymentQrUrl: p.paymentQrUrl ?? '',
});

/**
 * Mis datos. Mismo flujo que los datos del negocio: se ve en modo lectura, «Editar» lo habilita y
 * Cancelar/Guardar lo cierran. Se manda **sólo lo que cambió** (`diffProfile` de `shared`), que
 * además traduce «vaciar el QR» a `null` — para el servidor, borrarlo y no tocarlo son cosas
 * distintas.
 *
 * Se registra como sección «inline» en la barra de guardado: no dibuja la barra, pero cambiar de
 * pestaña o recargar con cambios pendientes pide confirmación.
 */
export function ProfileForm({ profile, roleLabel }: { profile: MyProfile; roleLabel?: string }) {
  const t = useTranslations('profile');
  const router = useRouter();
  const toast = useToast();

  const [initial, setInitial] = useState(() => formOf(profile));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const patch = diffProfile(initial, form);
  const dirty = hasChanges(patch);

  async function save(e?: React.FormEvent): Promise<boolean> {
    e?.preventDefault();
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<MyProfile>('/api/account/profile', patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return false;
    }
    setInitial(form);
    setEditing(false);
    toast(t('saved'));
    // El nombre y la foto también viven en la topbar, que la pintó el servidor.
    router.refresh();
    return true;
  }

  function cancel() {
    setForm(initial);
    setError(null);
    setEditing(false);
  }

  useSaveSection('perfil', { dirty, saving, valid: true, inline: true, save, reset: cancel });

  const disabled = !editing;
  const texts = { uploading: t('uploading'), remove: t('remove'), uploadError: t('uploadError'), dropTitle: t('dropTitle'), dropOr: t('dropOr') };

  return (
    <form onSubmit={save} className="space-y-6">
      <ErrorBanner message={error} />

      <Section title={t('personalData')} description={t('personalDataHint')} inner="space-y-5 px-6 pb-6 pt-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={`${t('firstName')} *`}>
            <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} disabled={disabled} required maxLength={80} />
          </Field>
          <Field label={`${t('lastName')} *`}>
            <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} disabled={disabled} required maxLength={80} />
          </Field>
          <Field label={t('email')} hint={t('emailFixed')}>
            <Input type="email" value={profile.email} disabled readOnly />
          </Field>
          <Field label={t('role')}>
            <Input value={roleLabel ?? ''} disabled readOnly />
          </Field>
          {/*
            El `pattern` es la misma forma que valida el móvil y evita el 400 del `@Length(5,32)`
            del servidor. Importa porque el PATCH es uno solo: un teléfono corto rechazaba también
            el nombre y la foto que se hubieran cambiado en la misma tanda. Vacío sigue valiendo —
            el navegador no aplica `pattern` a un campo vacío y borrarlo lo quita.
          */}
          <Field label={t('phone')} hint={t('phoneHint')}>
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              disabled={disabled}
              maxLength={32}
              pattern="[\d+][\d\s-]{4,}"
              title={t('phoneHint')}
              placeholder={t('phonePlaceholder')}
            />
          </Field>
        </div>
      </Section>

      <Section title={t('imagesTitle')} description={t('imagesHint')} inner="px-6 pb-6 pt-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <ImageUploadField
            texts={texts}
            label={t('photo')}
            hint={t('photoHint')}
            value={form.photoUrl}
            onChange={(url) => setForm({ ...form, photoUrl: url })}
            onError={setError}
            disabled={disabled}
          />
          <div className="space-y-3">
            <ImageUploadField
              texts={texts}
              label={t('paymentQr')}
              hint={t('paymentQrHint')}
              value={form.paymentQrUrl}
              onChange={(url) => setForm({ ...form, paymentQrUrl: url })}
              onError={setError}
              disabled={disabled}
            />
            {/* Ver en grande sólo lo ya guardado: lo recién subido todavía no es «tu QR». */}
            {initial.paymentQrUrl && form.paymentQrUrl === initial.paymentQrUrl && <QrViewer url={initial.paymentQrUrl} />}
          </div>
        </div>
      </Section>

      <div className="flex justify-end gap-3 border-t border-k-border pt-5">
        {editing ? (
          <>
            <span className="w-full sm:w-36">
              <Button type="button" variant="ghost" disabled={saving} onClick={cancel}>
                {t('cancel')}
              </Button>
            </span>
            <span className="w-full sm:w-48">
              <Button type="submit" loading={saving} disabled={!dirty}>
                {t('save')}
              </Button>
            </span>
          </>
        ) : (
          <span className="w-full sm:w-48">
            <Button type="button" onClick={() => setEditing(true)}>
              {t('edit')}
            </Button>
          </span>
        )}
      </div>
    </form>
  );
}
