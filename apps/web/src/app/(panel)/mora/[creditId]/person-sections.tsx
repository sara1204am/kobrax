'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ClientDetail } from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { ContactList, LocationList } from '../../cartera/[id]/client-contacts';
import { CollateralsSection, GuarantorsSection } from '../../cartera/[id]/backing-sections';
import { AttachmentsSection } from '../../cartera/[id]/attachments-section';

const noop = () => undefined;

/**
 * La persona **al servicio de la recuperación**: con quién hablar, dónde buscarla y quién responde por ESTE
 * crédito. Son los mismos componentes de la ficha del cliente (Cartera), en modo lectura.
 *
 * 🔴 **Sólo lectura, y a propósito.** Corregir un teléfono o una dirección se hace en Cartera, donde el formulario
 * revela la ficha y guarda bien; acá se consulta. Por eso `canWrite` va fijo en `false` y no hay «Editar».
 *
 * 🔴 **Garantes y garantías son los de este crédito**, no todos los del cliente: una persona con tres créditos
 * tiene garantes distintos en cada uno, y a quien se llama cuando éste no paga es al que lo respalda.
 *
 * 🔴 **Carga enmascarada.** «Mostrar» revela la ficha entera y deja una sola entrada de auditoría (`PII_REVEAL`),
 * igual que en Cartera: una persona mirando un cliente deja un registro, no uno por dato.
 */
export function PersonSections({
  creditId,
  client,
  currency,
  collateralTypes,
}: {
  creditId: string;
  client: ClientDetail;
  currency: string;
  collateralTypes: CatalogOption[];
}) {
  const t = useTranslations('portfolio');
  const toast = useToast();
  const [shown, setShown] = useState(client);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    const { ok, data } = await postJson<ClientDetail>(`/api/clients/${client.id}/reveal`, {});
    setBusy(false);
    if (!ok) {
      toast(data.error?.message ?? t('revealError'), 'danger');
      return;
    }
    setShown(data);
    setRevealed(true);
  }

  // Sólo lo que respalda ESTE crédito. Un garante sin créditos no responde por ninguno.
  const forCredit = useMemo<ClientDetail>(
    () => ({
      ...shown,
      relations: (shown.relations ?? []).filter((r) => r.creditIds?.includes(creditId)),
      collaterals: (shown.collaterals ?? []).filter((c) => c.creditIds?.includes(creditId)),
    }),
    [shown, creditId],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <ContactList rows={shown.contacts ?? []} revealed={revealed} onReveal={() => void reveal()} busy={busy} canWrite={false} onEdit={noop} />
        <LocationList rows={shown.locations ?? []} revealed={revealed} onReveal={() => void reveal()} busy={busy} canWrite={false} onEdit={noop} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <GuarantorsSection client={forCredit} canWrite={false} onEdit={noop} />
        <CollateralsSection client={forCredit} currency={currency} types={collateralTypes} canWrite={false} onEdit={noop} />
      </div>
      <AttachmentsSection clientId={client.id} rows={client.attachments ?? []} canWrite={false} />
    </div>
  );
}
