'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  buildClientePayload,
  canSubmitCliente,
  diffCliente,
  hasClientChanges,
  hydrateCliente,
  initialCliente,
  type ClientDetail,
  type ClienteForm,
} from '@kobrax/shared';
import { PageHeader } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { ClientFormFields } from '@/components/client-form';
import { useToast } from '@/components/toast';
import { postJson, sendJson } from '@/lib/client';

/**
 * Alta y edición de cliente — **la misma pantalla**.
 *
 * La diferencia es de dónde sale el estado inicial y a dónde va el guardado: un alta manda el
 * formulario entero (la API lo crea todo en una transacción), una edición manda **sólo el diff**
 * (`diffCliente`), porque los sub-recursos tienen cada uno su endpoint y `UpdateClientDto` no los
 * acepta.
 *
 * 🔴 En la edición, `client` **tiene que venir con la PII en claro** (`?reveal=true`). Con el valor
 * enmascarado, guardar escribiría la máscara encima del carnet real — ya pasó una vez, en el móvil.
 */
export function ClientEditor({ client }: { client?: ClientDetail }) {
  const t = useTranslations('portfolio');
  const router = useRouter();
  const toast = useToast();

  const [initial] = useState<ClienteForm>(() => (client ? hydrateCliente(client) : initialCliente()));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ops = client ? diffCliente(initial, form) : null;
  const dirty = ops ? hasClientChanges(ops) : true;
  const valid = canSubmitCliente(form);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const res = client
      ? await sendJson<{ applied: number }>(`/api/clients/${client.id}`, ops, 'PATCH')
      : await postJson<ClientDetail>('/api/clients', buildClientePayload(form));
    setSaving(false);

    if (!res.ok) {
      // El servidor sabe por qué: documento duplicado, falta el apellido, no tenés permiso.
      // Re-escribirlo acá sería adivinar.
      setError(res.data.error?.message ?? t('saveError'));
      return;
    }

    toast(t('saved'));
    const id = client?.id ?? (res.data as ClientDetail).id;
    router.push(`/cartera/${id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <PageHeader
        title={client ? t('editTitle') : t('newTitle')}
        subtitle={client ? t('editSubtitle') : t('newSubtitle')}
        actions={
          <>
            <span className="w-32">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                {t('cancel')}
              </Button>
            </span>
            <span className="w-44">
              <Button type="submit" loading={saving} disabled={!valid || !dirty}>
                {t('save')}
              </Button>
            </span>
          </>
        }
      />

      <ErrorBanner message={error} />
      {/* El mínimo que exige el servidor: nombre, apellido y un teléfono. Se dice, en vez de
          dejar el botón apagado sin explicar por qué. */}
      {!valid && <p className="text-[13px] text-k-muted">{t('form.minimum')}</p>}

      <ClientFormFields form={form} onChange={setForm} />
    </form>
  );
}
