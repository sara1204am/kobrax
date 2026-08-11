'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { diffProfile, hasChanges, type MyProfile, type ProfileForm as Form } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';

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

      <FilePick
        label={t('photo')}
        hint={t('photoHint')}
        value={form.photoUrl}
        onChange={(url) => setForm({ ...form, photoUrl: url })}
        onError={setError}
      />

      <FilePick
        label={t('paymentQr')}
        hint={t('paymentQrHint')}
        value={form.paymentQrUrl}
        onChange={(url) => setForm({ ...form, paymentQrUrl: url })}
        onError={setError}
      />

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

/**
 * Un archivo: `<input type="file">` nativo, sin librería.
 *
 * Sube al toque y guarda la URL en el formulario, pero **no persiste nada**: recién se ata al
 * perfil cuando se guarda. Vaciarlo es quitar la imagen, y `diffProfile` traduce ese `''` a
 * `null` para el QR.
 */
function FilePick({
  label,
  hint,
  value,
  onChange,
  onError,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (url: string) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations('profile');
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  async function upload(file: File) {
    setBroken(false);
    setBusy(true);
    const data = new FormData();
    data.append('file', file);
    const res = await fetch('/api/account/upload', { method: 'POST', body: data });
    const json = (await res.json().catch(() => ({}))) as { url?: string; error?: { message: string } };
    setBusy(false);
    if (!res.ok || !json.url) {
      onError(json.error?.message ?? t('uploadError'));
      return;
    }
    onChange(json.url);
  }

  return (
    <div className="space-y-2">
      <span className="block text-[14px] font-medium text-k-text">{label}</span>
      <div className="flex items-center gap-3">
        {value && !broken && (
          // eslint-disable-next-line @next/next/no-img-element -- lo sirve el BFF con la sesión
          <img
            src={value}
            alt=""
            /*
             * Si el archivo no está, se esconde en vez de dejar el ícono de imagen rota.
             * Pasa de verdad: `/uploads` guarda por tenant pero `photoUrl` vive en el perfil,
             * que es global, así que quien pertenece a dos empresas no la ve en la otra.
             * Arreglarlo de raíz es del lado de la API (guardar el perfil fuera del tenant).
             */
            onError={() => setBroken(true)}
            className="h-16 w-16 rounded-xl border border-k-border object-cover"
          />
        )}
        <div className="flex-1 space-y-1">
          <input
            type="file"
            accept="image/*"
            aria-label={label}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Limpiar el valor: si no, volver a elegir EL MISMO archivo no dispara `change`
              // y reintentar una subida que falló parece que no hace nada.
              e.target.value = '';
              if (file) void upload(file);
            }}
            className="block w-full text-[13px] text-k-text-2 file:mr-3 file:rounded-lg file:border file:border-k-border file:bg-white file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-k-text-2 hover:file:bg-k-bg"
          />
          <p className="text-[12px] text-k-muted">{busy ? t('uploading') : hint}</p>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[13px] font-medium text-k-danger hover:underline"
          >
            {t('remove')}
          </button>
        )}
      </div>
    </div>
  );
}
