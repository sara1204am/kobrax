'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ClientAttachmentDetail, ClientContactDetail, ClientDetail, ClientLocationDetail } from '@kobrax/shared';
import { Badge, PageHeader } from '@/components/panel-ui';
import { Button } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { date, fullName } from '@/lib/format';

const STATUS_TONE = { ACTIVE: 'success', INACTIVE: 'neutral', BLOCKED: 'danger' } as const;

/**
 * La ficha, en una columna con secciones.
 *
 * 🔴 **La PII arranca enmascarada y se revela con un click.** El `reveal` deja rastro en la
 * auditoría (`client/PII_REVEAL`): revelar solo al abrir llenaría el registro de ruido y lo
 * volvería inútil justo el día que haya que leerlo. La respuesta del revelado **reemplaza al
 * cliente entero**, porque enmascarado y en claro son la misma ficha con distinta profundidad.
 */
export function ClientCard({ client }: { client: ClientDetail }) {
  const t = useTranslations('portfolio');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
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

  return (
    <>
      <PageHeader
        title={fullName(shown)}
        subtitle={t(`clientType.${shown.clientType}`)}
        actions={
          <>
            <Badge tone={STATUS_TONE[shown.status]}>{t(`clientStatus.${shown.status}`)}</Badge>
            {can('client:write') && (
              <span className="w-40">
                <Button variant="ghost" onClick={() => router.push(`/cartera/${client.id}/editar`)}>
                  {t('edit')}
                </Button>
              </span>
            )}
          </>
        }
      />

      <div className="space-y-4">
        <Section
          title={t('sections.data')}
          action={
            revealed ? (
              <span className="text-[13px] text-k-muted">{t('revealed')}</span>
            ) : (
              <button
                type="button"
                onClick={() => void reveal()}
                disabled={busy}
                className="text-[13px] font-medium text-k-purple hover:underline disabled:opacity-50"
              >
                {busy ? t('revealing') : t('reveal')}
              </button>
            )
          }
        >
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label={t('fields.document')} value={shown.nationalId} />
            <Item label={t('fields.taxId')} value={shown.taxId} />
            <Item label={t('fields.risk')} value={shown.riskSegment} />
            <Item label={t('fields.createdAt')} value={shown.createdAt ? date(shown.createdAt) : null} />
          </dl>
          {!revealed && <p className="mt-3 text-[12px] text-k-muted">{t('maskedHint')}</p>}
        </Section>

        <Section title={t('sections.contacts')}>
          <Rows
            rows={shown.contacts ?? []}
            empty={t('noContacts')}
            render={(c: ClientContactDetail) => (
              <>
                <span className="font-medium text-k-text">{c.value ?? '—'}</span>
                <span className="text-[13px] text-k-text-2">
                  {t(`contactType.${c.contactType}`)}
                  {c.isPrimary && ` · ${t('primary')}`}
                </span>
              </>
            )}
          />
        </Section>

        <Section title={t('sections.locations')}>
          <Rows
            rows={shown.locations ?? []}
            empty={t('noLocations')}
            render={(l: ClientLocationDetail) => (
              <>
                <span className="font-medium text-k-text">{l.address ?? '—'}</span>
                <span className="text-[13px] text-k-text-2">
                  {t(`locationType.${l.locationType}`)}
                  {l.zone && ` · ${l.zone}`}
                  {/* Sin punto no se puede dibujar en el mapa; la dirección igual existe. */}
                  {l.latitude == null && ` · ${t('noPin')}`}
                </span>
              </>
            )}
          />
        </Section>

        {/* Los garantes NO son una entidad: son `relations`, y sus teléfonos y direcciones cuelgan
            de ellos por `relationId` (misma tabla que los del cliente). */}
        <Section title={t('sections.guarantors')}>
          <Rows
            rows={shown.relations ?? []}
            empty={t('noGuarantors')}
            render={(r) => (
              <>
                <span className="font-medium text-k-text">{r.relatedName}</span>
                <span className="text-[13px] text-k-text-2">
                  {t(`relationType.${r.relationshipType}`)}
                  {!r.isContactable && ` · ${t('notContactable')}`}
                </span>
                {(r.contacts?.length || r.locations?.length) && (
                  <span className="mt-1 block text-[13px] text-k-text-2">
                    {[...(r.contacts ?? []).map((c) => c.value ?? '—'), ...(r.locations ?? []).map((l) => l.address ?? '—')].join(' · ')}
                  </span>
                )}
              </>
            )}
          />
        </Section>

        <Section title={t('sections.attachments')}>
          <Rows
            rows={shown.attachments ?? []}
            empty={t('noAttachments')}
            render={(a: ClientAttachmentDetail) => (
              <>
                <span className="font-medium text-k-text">{a.fileType}</span>
                <span className="text-[13px] text-k-text-2">
                  {date(a.createdAt)}
                  {/* El hash es lo que prueba que el archivo no cambió. Se muestra corto: entero
                      son 64 caracteres que nadie compara a ojo. */}
                  {a.fileHash && ` · ${a.fileHash.slice(0, 12)}…`}
                </span>
              </>
            )}
          />
          {/* No hay botón de «ver»: la API no expone la URL del archivo hasta el endpoint
              firmado (F6). Un botón que no funciona es peor que no tenerlo. */}
          <p className="mt-3 text-[12px] text-k-muted">{t('attachmentsHint')}</p>
        </Section>
      </div>
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-k-border bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-k-navy">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Item({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-k-text">{value || '—'}</dd>
    </div>
  );
}

function Rows<T extends { id: string }>({
  rows,
  empty,
  render,
}: {
  rows: T[];
  empty: string;
  render: (row: T) => ReactNode;
}) {
  if (rows.length === 0) return <p className="text-[14px] text-k-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-k-border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col py-2.5 first:pt-0 last:pb-0">
          {render(row)}
        </li>
      ))}
    </ul>
  );
}
