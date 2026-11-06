'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  buildClientePayload,
  canSubmitCliente,
  initialCliente,
  type ClientDetail,
  type ClienteForm,
} from '@kobrax/shared';
import { ClientFormFields, type CatalogOption } from '@/components/client-form';
import { OfficeSelect } from '@/components/office-select';
import { Button, ErrorBanner, Field } from '@/components/ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import type { OfficeOption } from '@/lib/offices';
import { duplicateBlocks, nameSignature, useDuplicateCheck } from '@/lib/duplicate-check';
import { DocumentTaken, NamesTaken } from './duplicate-notice';

/**
 * Dar de alta un cliente — **en un modal, sin salir de la cartera**.
 *
 * 🔴 **Era una ruta (`/cartera/nuevo`) y ahora no lo es.** El alta arranca desde la lista y termina
 * en la ficha del cliente nuevo: la pantalla intermedia sólo servía para perder los filtros que la
 * persona venía armando cuando se arrepentía. Cerrar el modal la devuelve a la misma cartera, con la
 * misma búsqueda y la misma página.
 *
 * 🔴 Esconder el botón sin permiso es cosmética: quien escriba la URL igual llega, y ahí lo frena la
 * API. Se esconde igual, porque ofrecer lo que va a fallar enseña a desconfiar de la pantalla.
 */
export function NewClientButton({
  currency,
  collateralTypes,
  collectionModalities = [],
  incomeSources = [],
  occupations = [],
  offices = [],
  defaultOfficeId = '',
}: {
  /** La moneda de la cuenta (Configuración): con la que arranca el valor de una garantía. */
  currency: string;
  collateralTypes: CatalogOption[];
  /** Catálogo `COLLECTION_MODALITY` (F4/13 · E2). */
  collectionModalities?: CatalogOption[];
  /** Catálogos `INCOME_SOURCE` y `OCCUPATION` (F4/13 · E3). */
  incomeSources?: CatalogOption[];
  occupations?: CatalogOption[];
  /** F14 · F2: las oficinas donde puede registrar (sin la central: el servidor no registra clientes ahí). Una sola = se manda sola. */
  offices?: OfficeOption[];
  /** La oficina de quien da de alta, si es una de las elegibles. */
  defaultOfficeId?: string;
}) {
  const t = useTranslations('portfolio');
  const { can } = usePermissions();
  const [abierto, setAbierto] = useState(false);
  // F14 · F2: dar de alta es `client:create` (editar sigue siendo `client:write`).
  if (!can('client:create')) return null;

  return (
    <>
      {/* A la medida de los otros botones de la barra de la tabla (h-9, 13 px): tres controles en una
          misma fila con tres alturas distintas se leen como tres cosas sin relación entre sí. */}
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex h-9 items-center justify-center rounded-lg bg-k-navy px-3 text-[13px] font-medium text-white transition-all hover:bg-k-slate active:scale-[.98]"
      >
        {t('new')}
      </button>

      {abierto && (
        <NewClientModal
          currency={currency}
          collateralTypes={collateralTypes}
          collectionModalities={collectionModalities}
          incomeSources={incomeSources}
          occupations={occupations}
          offices={offices}
          defaultOfficeId={defaultOfficeId}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  );
}

/**
 * El formulario del alta: **las mismas secciones que la ficha, plegadas en un acordeón**.
 *
 * Acá van todas juntas y no de a una como en la ficha, porque todavía no hay cliente contra el cual
 * editar por partes: el alta es una transacción sola (la API crea cliente, teléfonos, direcciones,
 * garantes y garantías en el mismo `POST`). Plegadas, porque lo único obligatorio es la
 * identificación: un formulario que abre con treinta campos a la vista se abandona antes de empezar.
 *
 * 🔴 **Se monta recién al abrir** (`{abierto && ...}`), y por eso el borrador arranca limpio cada
 * vez sin un solo `useEffect` de reset. Cerrar y volver a abrir es empezar de nuevo, que es lo que
 * significa cerrar.
 */
function NewClientModal({
  currency,
  collateralTypes,
  collectionModalities,
  incomeSources,
  occupations,
  offices,
  defaultOfficeId,
  onClose,
}: {
  currency: string;
  collateralTypes: CatalogOption[];
  collectionModalities: CatalogOption[];
  incomeSources: CatalogOption[];
  occupations: CatalogOption[];
  offices: OfficeOption[];
  defaultOfficeId: string;
  onClose: () => void;
}) {
  const t = useTranslations('portfolio');
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<ClienteForm>(initialCliente);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * F14 · F2 (H-7): la oficina donde se registra el cliente. Con una sola elegible se manda sola y no hay selector; con varias, quien
   * da de alta elige (arranca en la suya si es una de ellas). El servidor la valida contra el alcance igual: esto sólo la ofrece.
   */
  const [office, setOffice] = useState(offices.length === 1 ? offices[0]!.id : defaultOfficeId);
  const chooseOffice = offices.length > 1;
  const officeMissing = offices.length > 0 && !office;
  /*
   * Posibles duplicados, preguntados mientras se escribe: mejor enterarse en el campo que con un
   * error después de haber cargado teléfonos, direcciones y garantes.
   *  - Mismo carnet → bloquea (el servidor lo rechazaría igual).
   *  - Mismo nombre → avisa, y se guarda recién cuando la persona confirma «es otra persona». La
   *    confirmación es para ESE nombre: si lo cambia, vuelve a hacer falta.
   */
  const { result: dup, checking, checkNow } = useDuplicateCheck(form);
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const namesAccepted = acceptedFor === nameSignature(form);
  const blocked = duplicateBlocks(dup, namesAccepted);

  const valid = canSubmitCliente(form);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    // Otra vez y sin freno: la última respuesta puede ser de hace tres teclas.
    const fresh = await checkNow();
    if (duplicateBlocks(fresh, namesAccepted)) {
      setSaving(false);
      return;
    }
    const res = await postJson<ClientDetail>('/api/clients', { ...buildClientePayload(form), ...(office ? { branchId: office } : {}) });
    setSaving(false);

    if (!res.ok) {
      // El servidor sabe por qué: documento duplicado, falta el apellido, no tenés permiso.
      // Re-escribirlo acá sería adivinar.
      setError(res.data.error?.message ?? t('saveError'));
      // Si el carnet se ocupó entre el chequeo y el guardado (otra persona dando de alta al mismo
      // deudor), se pregunta de nuevo para mostrar de quién es, no sólo «ya existe».
      if (res.data.error?.code === 'CLIENT_DUP') void checkNow();
      return;
    }

    toast(t('saved'));
    router.push(`/cartera/${res.data.id}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={guardar}
      /*
       * 🔴 **Un campo obligatorio dentro de una sección plegada no se puede enfocar**, y ahí el
       * navegador cancela el envío **sin decir nada**: se toca «Guardar» y no pasa absolutamente
       * nada. Se abre su sección para que el globito del navegador tenga a qué apuntar. React hace
       * burbujear `invalid`, así que un solo handler cubre las cinco secciones.
       */
      onInvalid={(e) => (e.target as HTMLElement).closest('details')?.setAttribute('open', '')}
    >
      <Modal
        wide
        open
        onClose={onClose}
        title={t('newTitle')}
        actions={
          <>
            <span className="sm:w-32">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-44">
              <Button type="submit" loading={saving} disabled={!valid || blocked !== null || officeMissing}>
                {t('save')}
              </Button>
            </span>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-k-text-2">{t('newSubtitle')}</p>
        <ErrorBanner message={error} />
        {/* El mínimo que exige el servidor: quién es (nombre y apellido, o razón social) y un
            teléfono. Se dice, en vez de dejar el botón apagado sin explicar por qué. */}
        {!valid && <p className="mb-3 mt-2 text-[13px] text-k-muted">{t('form.minimum')}</p>}
        {checking && <p className="mb-3 mt-2 text-[13px] text-k-muted">{t('duplicate.checking')}</p>}

        {/* El carnet tomado no va acá: va bajo su campo. Si además hay homónimos, se ve el carnet
            primero, que es lo que bloquea. */}
        {dup && !dup.document && dup.names.length > 0 && (
          <NamesTaken
            matches={dup.names}
            accepted={namesAccepted}
            onAccept={(v) => setAcceptedFor(v ? nameSignature(form) : null)}
            disabled={saving}
          />
        )}

        {chooseOffice && (
          <div className="mb-4">
            <Field label={t('registerOffice.label')} hint={t('registerOffice.hint')}>
              <OfficeSelect options={offices} emptyLabel={t('registerOffice.pick')} value={office} onChange={(e) => setOffice(e.target.value)} disabled={saving} />
            </Field>
          </div>
        )}

        {/* Sin créditos: el préstamo se carga después, desde la ficha. El garante se guarda igual y
            el vínculo se arma al editar — al revés no se podría dar de alta a nadie. */}
        <ClientFormFields
          form={form}
          onChange={setForm}
          disabled={saving}
          collateralTypes={collateralTypes}
          collectionModalities={collectionModalities}
          incomeSources={incomeSources}
          occupations={occupations}
          currency={currency}
          documentNotice={dup?.document ? <DocumentTaken match={dup.document} /> : undefined}
        />
      </Modal>
    </form>
  );
}
