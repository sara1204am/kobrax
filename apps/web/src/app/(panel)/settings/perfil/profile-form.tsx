'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { diffProfile, hasChanges, type MyProfile, type ProfileForm as Form } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { ImageUploadField } from '@/components/image-upload-field';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { QrViewer } from './qr-viewer';

const formOf = (p: MyProfile): Form => ({
  firstName: p.firstName ?? '',
  lastName: p.lastName ?? '',
  phone: p.phone ?? '',
  photoUrl: p.photoUrl ?? '',
  paymentQrUrl: p.paymentQrUrl ?? '',
});

/**
 * Mi perfil. Mismo trato que los datos del negocio: se manda **sólo lo que cambió**
 * (`diffProfile` de `shared`), que además traduce «vaciar el QR» a `null` — para el servidor,
 * borrarlo y no tocarlo son cosas distintas.
 */
export function ProfileForm({ profile }: { profile: MyProfile }) {
  const t = useTranslations('profile');
  const router = useRouter();
  const toast = useToast();

  const [initial, setInitial] = useState(() => formOf(profile));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = diffProfile(initial, form);
  const dirty = hasChanges(patch);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<MyProfile>('/api/account/profile', patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    setInitial(form);
    toast(t('saved'));
    // El nombre y la foto también viven en la topbar, que la pintó el servidor.
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-k-border bg-white p-6">
      <ErrorBanner message={error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('firstName')}>
          <Input
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            required
            maxLength={80}
          />
        </Field>
        <Field label={t('lastName')}>
          <Input
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            required
            maxLength={80}
          />
        </Field>
      </div>

      {/*
        El `pattern` es la misma forma que valida el móvil y evita el 400 del `@Length(5,32)`
        del servidor. Importa porque el PATCH es uno solo: un teléfono corto rechazaba también
        el nombre y la foto que se hubieran cambiado en la misma tanda. Vacío sigue valiendo —
        el navegador no aplica `pattern` a un campo vacío y borrarlo lo quita.
      */}
      <Field label={t('phone')}>
        <Input
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          maxLength={32}
          pattern="[\d+][\d\s-]{4,}"
          title={t('phoneHint')}
          placeholder={t('phonePlaceholder')}
        />
      </Field>

      <p className="text-[13px] text-k-text-2">
        {t('emailFixed', { email: profile.email })}
      </p>

      <ImageUploadField
        texts={{ uploading: t('uploading'), remove: t('remove'), uploadError: t('uploadError') }}
        label={t('photo')}
        hint={t('photoHint')}
        value={form.photoUrl}
        onChange={(url) => setForm({ ...form, photoUrl: url })}
        onError={setError}
      />

      <ImageUploadField
        texts={{ uploading: t('uploading'), remove: t('remove'), uploadError: t('uploadError') }}
        label={t('paymentQr')}
        hint={t('paymentQrHint')}
        value={form.paymentQrUrl}
        onChange={(url) => setForm({ ...form, paymentQrUrl: url })}
        onError={setError}
      />
      {/* Ver en grande sólo lo ya guardado: lo recién subido todavía no es «tu QR». */}
      {initial.paymentQrUrl && form.paymentQrUrl === initial.paymentQrUrl && (
        <QrViewer url={initial.paymentQrUrl} />
      )}

      <div className="flex justify-end">
        <span className="w-full sm:w-56">
          <Button type="submit" loading={saving} disabled={!dirty}>
            {t('save')}
          </Button>
        </span>
      </div>
    </form>
  );
}
