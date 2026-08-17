'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  diffCliente,
  hasClientChanges,
  hydrateCliente,
  type ClientDetail,
  type ClienteForm,
  type CreditOption,
} from '@kobrax/shared';
import {
  CollateralRows,
  ContactRows,
  GuarantorRows,
  IdentityFields,
  LocationRows,
  nuevaFila,
  type CatalogOption,
} from '@/components/client-form';
import { Button, ErrorBanner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';

/** Las secciones de la ficha que se pueden corregir. Cada una edita **sólo lo suyo**. */
export type SectionKey = 'identity' | 'contacts' | 'locations' | 'guarantors' | 'collaterals';

/** Lo que toda sección necesita para dibujarse y para guardar. */
export interface SectionContext {
  /** 🔴 Con la PII **en claro**. Con la máscara, guardar la escribe encima del dato real. */
  client: ClientDetail;
  credits: CreditOption[];
  collateralTypes: CatalogOption[];
  /** La moneda de la cuenta (Configuración), con la que arranca el valor de una garantía. */
  currency: string;
  /** Releer el cliente revelado y refrescar el server component. Lo provee la ficha. */
  onSaved: () => Promise<void>;
}

/**
 * Editar **una** sección de la ficha.
 *
 * 🔴 **No hay pantalla de edición: hay una ficha que se corrige por partes.** Antes, tocar «Editar»
 * —o peor, «Agregar garante»— llevaba a otra ruta con el formulario entero, con otro título y otro
 * orden, y quien lo abría tenía que volver a buscar dónde estaba cada cosa. Ahora cada bloque se
 * corrige donde se lee, y lo demás queda a la vista.
 *
 * 🔴 **El diff lo hace `diffCliente` sobre el formulario ENTERO, no sobre la sección.** Parece de
 * más y es justamente lo que hace que esto sea barato: la sección edita su rebanada de un
 * `ClienteForm` hidratado completo, y el diff devuelve por sí solo únicamente lo que cambió. No hay
 * un «diff de garantes» ni un endpoint nuevo — se guarda por el mismo `PATCH` que ya estaba escrito
 * y probado, el que arma `opsRequests`.
 */
export function SectionForm({
  section,
  ctx,
  onCancel,
}: {
  section: SectionKey;
  ctx: SectionContext;
  onCancel: () => void;
}) {
  const t = useTranslations('portfolio');
  const toast = useToast();
  const [initial] = useState<ClienteForm>(() => hydrateCliente(ctx.client));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ops = diffCliente(initial, form);
  const dirty = hasClientChanges(ops);
  /*
   * 🔴 **Corregir una sección NO exige el mínimo del alta.** El botón se abre con que haya algo que
   * mandar, y punto. Pedir acá «nombre + apellido + un teléfono» —lo que exige `canSubmitCliente`—
   * dejaba el guardar apagado para un cliente importado sin teléfono, por un campo que ni siquiera
   * está en pantalla, y sin decir cuál. Lo que sí se exige de cada sección lo aplica el navegador
   * sobre los campos que se ven: `required` en el nombre, forma de teléfono, valor no negativo.
   */

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await sendJson<{ applied: number }>(`/api/clients/${ctx.client.id}`, ops, 'PATCH');
    setSaving(false);

    if (!res.ok) {
      // El servidor sabe por qué: documento duplicado, falta el apellido, no tenés permiso.
      // Re-escribirlo acá sería adivinar.
      setError(res.data.error?.message ?? t('saveError'));
      return;
    }

    toast(t('saved'));
    await ctx.onSaved();
    onCancel();
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <ErrorBanner message={error} />
      <Fields section={section} form={form} onChange={setForm} ctx={ctx} disabled={saving} />

      {/* Pegadas abajo: en el formulario largo de antes el botón de guardar quedaba arriba de todo,
          así que se llegaba al final de la carga sin nada que tocar. */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-k-border bg-white py-3">
        <span className="w-32">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </span>
        <span className="w-40">
          <Button type="submit" loading={saving} disabled={!dirty}>
            {t('save')}
          </Button>
        </span>
      </div>
    </form>
  );
}

/** Los campos de la sección + su botón de agregar. Cada uno sale tal cual de `client-form`. */
function Fields({
  section,
  form,
  onChange,
  ctx,
  disabled,
}: {
  section: SectionKey;
  form: ClienteForm;
  onChange: (next: ClienteForm) => void;
  ctx: SectionContext;
  disabled: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<ClienteForm>) => onChange({ ...form, ...patch });

  switch (section) {
    case 'identity':
      return <IdentityFields form={form} onChange={onChange} disabled={disabled} />;
    case 'contacts':
      return (
        <Agregar label={t('form.addContact')} onAdd={() => set({ contacts: [...form.contacts, nuevaFila.contact()] })} disabled={disabled}>
          <ContactRows rows={form.contacts} onChange={(contacts) => set({ contacts })} disabled={disabled} />
        </Agregar>
      );
    case 'locations':
      return (
        <Agregar label={t('form.addLocation')} onAdd={() => set({ locations: [...form.locations, nuevaFila.location()] })} disabled={disabled}>
          <LocationRows rows={form.locations} onChange={(locations) => set({ locations })} disabled={disabled} />
        </Agregar>
      );
    case 'guarantors':
      return (
        <Agregar label={t('form.addRelation')} onAdd={() => set({ relations: [...form.relations, nuevaFila.relation()] })} disabled={disabled}>
          <GuarantorRows rows={form.relations} onChange={(relations) => set({ relations })} credits={ctx.credits} disabled={disabled} />
        </Agregar>
      );
    case 'collaterals':
      return (
        <Agregar label={t('form.addCollateral')} onAdd={() => set({ collaterals: [...form.collaterals, nuevaFila.collateral()] })} disabled={disabled}>
          <CollateralRows
            rows={form.collaterals}
            onChange={(collaterals) => set({ collaterals })}
            credits={ctx.credits}
            types={ctx.collateralTypes}
            currency={ctx.currency}
            disabled={disabled}
          />
        </Agregar>
      );
  }
}

function Agregar({
  label,
  onAdd,
  disabled,
  children,
}: {
  label: string;
  onAdd: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="text-[13px] font-medium text-k-periwinkle hover:underline disabled:opacity-50"
      >
        + {label}
      </button>
    </>
  );
}

/**
 * La sección, en un modal centrado. **Las cinco pasan por acá.**
 *
 * 🔴 **Una sola forma de corregir.** Hubo dos intentos previos: un cajón pegado a la derecha (el
 * único diálogo del panel que no salía del centro) y los teléfonos editándose dentro de su propia
 * tarjeta mientras las otras cuatro abrían algo. Las dos veces el costo fue el mismo: la persona
 * tiene que aprender dónde va a aparecer cada sección. Ahora aparece siempre en el mismo lugar.
 */
export function SectionModal({
  section,
  ctx,
  onClose,
}: {
  section: SectionKey | null;
  ctx: SectionContext;
  onClose: () => void;
}) {
  const t = useTranslations('portfolio');
  if (!section) return null;

  return (
    <Modal wide open onClose={onClose} title={t(`sections.${section}`)}>
      {/* `key` para que cambiar de sección vuelva a hidratar el formulario desde el cliente actual:
          sin él, React reusaría el estado del `useState` inicial de la sección anterior. */}
      <SectionForm key={`${ctx.client.updatedAt}-${section}`} section={section} ctx={ctx} onCancel={onClose} />
    </Modal>
  );
}
