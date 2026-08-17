'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ClientDetail, CreditOption } from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Badge, PageHeader, Section } from '@/components/panel-ui';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { postJson, sendJson } from '@/lib/client';
import { date, fullName } from '@/lib/format';
import { ContactList, LocationList } from './client-contacts';
import { CollateralsSection, GuarantorsSection } from './backing-sections';
import { AttachmentsSection } from './attachments-section';
import { SectionModal, type SectionContext, type SectionKey } from './section-editor';

const STATUS_TONE = { ACTIVE: 'success', INACTIVE: 'neutral', BLOCKED: 'danger' } as const;

/**
 * La ficha, en secciones — **y es la única pantalla del cliente**.
 *
 * 🔴 **No hay ruta de edición.** La había, y era el problema: `/cartera/:id/editar` repetía las
 * mismas secciones con otro título, otro orden y otro ancho, así que mirar un cliente y corregirlo
 * se sentían dos productos. Peor, «Agregar garante» —un botón de una sección de la derecha— saltaba
 * a esa pantalla entera. Ahora cada sección se corrige desde su propio encabezado, en un modal
 * centrado que deja la ficha detrás: las cinco igual, y ninguna manda a otra ruta.
 *
 * 🔴 **La PII arranca enmascarada y se revela con un click.** El `reveal` deja rastro en la
 * auditoría (`client/PII_REVEAL`): revelar solo al abrir llenaría el registro de ruido y lo
 * volvería inútil justo el día que haya que leerlo. **Tocar «Editar» revela primero** —editar es
 * pedir los datos completos, y con la máscara cargada guardar la escribiría encima del carnet real,
 * que es el bug que ya ocurrió una vez en el móvil.
 */
export function ClientCard({
  client,
  credits,
  creditOptions,
  summary,
  timeline,
  cases,
  currency,
  collateralTypes,
  hasActiveCredits,
}: {
  client: ClientDetail;
  /*
   * Las cuatro secciones que arma el servidor y bajan como `children`. Lo que no se edita —créditos,
   * casos, resumen, bitácora— no tiene por qué viajar como JavaScript al navegador.
   */
  credits?: ReactNode;
  summary?: ReactNode;
  timeline?: ReactNode;
  cases?: ReactNode;
  /** Los mismos créditos, crudos: el modal necesita ofrecerlos para vincular garantes y garantías. */
  creditOptions: CreditOption[];
  /** La moneda de la cuenta (Configuración), para las garantías que no traen la suya. */
  currency: string;
  /** Catálogo `COLLATERAL_TYPE` del tenant: código → rótulo. */
  collateralTypes: CatalogOption[];
  /** Con plata en la calle no se archiva a nadie: la API lo frena y la pantalla no lo ofrece. */
  hasActiveCredits?: boolean;
}) {
  const t = useTranslations('portfolio');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const [shown, setShown] = useState(client);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmBaja, setConfirmBaja] = useState(false);
  const [editando, setEditando] = useState<SectionKey | null>(null);

  const canWrite = can('client:write');

  async function darDeBaja() {
    setBusy(true);
    const { ok, data } = await sendJson(`/api/clients/${client.id}`, null, 'DELETE');
    setBusy(false);
    setConfirmBaja(false);
    if (!ok) {
      // El servidor sabe por qué: tiene créditos activos, no tenés permiso.
      return toast(data.error?.message ?? t('actionError'), 'danger');
    }
    toast(t('archived'));
    router.push('/cartera');
    router.refresh();
  }

  /** Trae la ficha en claro y la deja en pantalla. Devuelve el cliente revelado, o `null` si falló. */
  async function reveal(): Promise<ClientDetail | null> {
    setBusy(true);
    const { ok, data } = await postJson<ClientDetail>(`/api/clients/${client.id}/reveal`, {});
    setBusy(false);
    if (!ok) {
      toast(data.error?.message ?? t('revealError'), 'danger');
      return null;
    }
    setShown(data);
    setRevealed(true);
    return data;
  }

  /**
   * Abrir una sección para corregirla.
   *
   * 🔴 **Revela primero si hace falta.** No es una comodidad: el formulario se hidrata de `shown`, y
   * con la máscara cargada guardar escribiría `1234***` encima del carnet. Sale **una** entrada de
   * auditoría, la misma que deja el «Mostrar» de la lista de teléfonos — es el mismo acto.
   */
  async function editar(section: SectionKey) {
    if (!revealed && !(await reveal())) return;
    setEditando(section);
  }

  /**
   * Después de guardar: **volver a leer la ficha en claro** y refrescar lo que pinta el servidor.
   *
   * Cuesta una segunda entrada de `PII_REVEAL` por sesión de edición, y es el precio correcto: la
   * alternativa era dejar en pantalla los datos viejos, o re-enmascarar justo lo que la persona
   * acaba de corregir y no la deja verificar que quedó bien. El `refresh` es por la bitácora, que
   * la arma el servidor y donde la corrección tiene que aparecer.
   */
  async function recargar() {
    await reveal();
    router.refresh();
  }

  const ctx: SectionContext = {
    client: shown,
    credits: creditOptions,
    collateralTypes,
    currency,
    onSaved: recargar,
  };

  /** El botón «Editar» de un encabezado de sección. Sin permiso de escritura no se dibuja. */
  const editarAction = (section: SectionKey) =>
    canWrite ? (
      <button
        type="button"
        onClick={() => void editar(section)}
        disabled={busy}
        className="text-[13px] font-medium text-k-periwinkle hover:underline disabled:opacity-50"
      >
        {t('edit')}
      </button>
    ) : undefined;

  return (
    <>
      <PageHeader
        title={fullName(shown)}
        subtitle={t(`clientType.${shown.clientType}`)}
        badge={<Badge tone={STATUS_TONE[shown.status]}>{t(`clientStatus.${shown.status}`)}</Badge>}
        actions={
          <>
            {/* La baja no se ofrece si hay plata en la calle: la API la rechaza igual, pero un
                botón que siempre falla enseña a desconfiar de la pantalla. */}
            {canWrite && !hasActiveCredits && shown.status !== 'INACTIVE' && (
              <button
                type="button"
                onClick={() => setConfirmBaja(true)}
                className="text-[13px] font-medium text-k-danger hover:underline"
              >
                {t('archive')}
              </button>
            )}
          </>
        }
      />

      {/*
       * Dos columnas: a la izquierda lo que se trabaja —quién es, los créditos, con quién hablar,
       * dónde buscarlo—, a la derecha lo que se consulta. La ficha antes era una sola columna donde
       * el saldo y los adjuntos pesaban lo mismo, y había que scrollear para saber cuánto debe.
       */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {/*
           * 🔴 **La identificación es una sección, no una fila de texto suelta bajo el título.**
           * Como línea corrida no tenía dónde colgar su «Editar», y era la única parte del cliente
           * que obligaba a irse a otra pantalla para corregir una letra del apellido.
           *
           * Cada dato es su propio elemento, no una frase armada con `join(' · ')`: pegados en un
           * solo texto no se puede seleccionar el documento para copiarlo, y un lector de pantalla
           * lee «Persona 1234 asterisco asterisco» de corrido. Los separadores son de CSS.
           */}
          <Section title={t('sections.identity')} action={editarAction('identity')}>
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
              <Dato label={t('fields.document')} value={shown.nationalId || '—'} />
              {shown.taxId && <Dato label={t('fields.taxId')} value={shown.taxId} />}
              {shown.riskSegment && <Dato label={t('fields.risk')} value={shown.riskSegment} />}
              {shown.createdAt && <Dato label={t('fields.createdAt')} value={date(shown.createdAt, locale)} />}
            </dl>
          </Section>

          {/*
           * Los créditos los pinta el servidor y bajan como children: esta tarjeta es cliente por
           * el revelado, y no hay razón para que esa lista viaje como JavaScript.
           *
           * 🔴 **«Nuevo préstamo» vive acá, en el encabezado de su sección, y no arriba en la barra
           * de la ficha.** Ahí compitía con «Dar de baja» y con el estado del cliente, tres cosas sin
           * relación entre sí en una misma fila; y sobre todo, dar un préstamo es una acción **sobre
           * esta lista** — el lugar donde se busca es el mismo donde se ve que no hay ninguno.
           */}
          {credits && (
            <Section
              title={t('sections.credits')}
              action={
                can('credit:write') && (
                  <Link
                    href={`/cartera/${client.id}/prestamo`}
                    className="inline-flex min-h-[32px] items-center rounded-lg bg-k-highlight px-3 text-[13px] font-medium text-k-periwinkle hover:bg-k-light-bg"
                  >
                    + {t('newLoan')}
                  </Link>
                )
              }
            >
              {credits}
            </Section>
          )}

          {/*
           * Con quién hablar y dónde buscarlo, **lado a lado**: son la misma pregunta y en una
           * columna quedaban una debajo de la otra, obligando a scrollear para cruzarlas.
           *
           * 🔴 El «Mostrar» de cada fila **revela la ficha entera** —una sola entrada de auditoría,
           * que es la verdad de lo que pasó—; por eso las dos listas comparten el mismo `reveal`.
           */}
          <div className="grid gap-5 sm:grid-cols-2">
            <ContactList
              rows={shown.contacts ?? []}
              revealed={revealed}
              onReveal={() => void reveal()}
              busy={busy}
              canWrite={canWrite}
              onEdit={() => void editar('contacts')}
            />
            <LocationList
              rows={shown.locations ?? []}
              revealed={revealed}
              onReveal={() => void reveal()}
              busy={busy}
              onEdit={() => void editar('locations')}
              canWrite={canWrite}
            />
          </div>

          <AttachmentsSection clientId={client.id} rows={shown.attachments ?? []} canWrite={canWrite} />

          {/* Los casos cierran la columna: son cómo la empresa organiza el trabajo, no un dato del
              deudor. Bajan del servidor como los créditos. */}
          {cases}
        </div>

        {/* La columna de consulta: cuánto debe, qué se hizo, y quién responde si no paga. */}
        <div className="space-y-5">
          {summary}
          {timeline}

          {/*
           * Quién y qué respalda la deuda. Se pintan con `shown`, no con `client`: **el revelado
           * también destapa los teléfonos del garante** —es a quien se llama cuando el deudor no
           * aparece—, y con el cliente original quedarían tapados para siempre.
           */}
          <GuarantorsSection client={shown} canWrite={canWrite} onEdit={() => void editar('guarantors')} />
          <CollateralsSection
            client={shown}
            currency={currency}
            types={collateralTypes}
            canWrite={canWrite}
            onEdit={() => void editar('collaterals')}
          />
        </div>
      </div>

      <SectionModal section={editando} ctx={ctx} onClose={() => setEditando(null)} />

      <Modal
        open={confirmBaja}
        onClose={() => setConfirmBaja(false)}
        title={t('confirmArchive.title', { name: fullName(shown) })}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setConfirmBaja(false)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button loading={busy} onClick={() => void darDeBaja()}>
                {t('confirmArchive.ok')}
              </Button>
            </span>
          </>
        }
      >
        {t('confirmArchive.text')}
      </Modal>
    </>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <dt className="text-k-muted">{label}</dt>
      <dd className="font-medium text-k-text">{value}</dd>
    </span>
  );
}

/*
 * Acá vivía `Rows`, la lista genérica que pintaba teléfonos, direcciones, garantes, garantías y
 * adjuntos todos iguales. Se fue con ellos: cada sección ahora se dibuja como lo que es —una con
 * íconos y botón de revelar, otra con vacío ilustrado, otra con zona de arrastre— y una lista
 * genérica que ya no usa nadie es una invitación a volver a hacerlos todos iguales.
 */
