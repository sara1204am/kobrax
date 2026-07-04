import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiCall } from '@/lib/bff';
import { Badge, Card, Field, PanelHeading, statusTone } from '@/components/panel';
import { date, fullName } from '@/lib/format';

interface Contact { id: string; contactType: string; value?: string; isPrimary: boolean; isVerified: boolean }
interface Location { id: string; locationType: string; address?: string; zone?: string }
interface Relation { id: string; relatedName: string; relationshipType: string; phone?: string; isContactable: boolean }
interface ClientDetail {
  id: string;
  clientType: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId?: string;
  taxId?: string;
  status: string;
  riskSegment?: string;
  createdAt: string;
  contacts?: Contact[];
  locations?: Location[];
  relations?: Relation[];
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { reveal?: string };
}) {
  const reveal = searchParams.reveal === '1';
  const { status, body } = await apiCall<ClientDetail>(`/clients/${params.id}${reveal ? '?reveal=true' : ''}`, { method: 'GET', auth: true });
  if (status === 404) notFound();
  const c = body.data;
  if (status !== 200 || !c) {
    return <p className="text-[14px] text-k-danger">No se pudo cargar el cliente ({body.error?.code ?? status}).</p>;
  }

  return (
    <>
      <Link href="/panel/clients" className="text-[13px] font-medium text-k-purple">← Clientes</Link>
      <PanelHeading
        title={fullName(c)}
        subtitle={c.clientType === 'COMPANY' ? 'Empresa' : 'Persona natural'}
        action={
          reveal ? (
            <Link href={`/panel/clients/${c.id}`} className="rounded-md border border-k-border px-3 py-1.5 text-[13px] text-k-text-2 hover:bg-k-bg">🙈 Ocultar PII</Link>
          ) : (
            <Link href={`/panel/clients/${c.id}?reveal=1`} className="rounded-md border border-k-border px-3 py-1.5 text-[13px] text-k-purple hover:bg-k-bg">👁 Revelar PII</Link>
          )
        }
      />

      <Card className="mb-4 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Documento" value={c.nationalId ?? '—'} mono />
          <Field label="NIT" value={c.taxId ?? '—'} mono />
          <Field label="Riesgo" value={c.riskSegment ?? '—'} />
          <Field label="Estado" value={<Badge tone={statusTone(c.status)}>{c.status}</Badge>} />
          <Field label="Alta" value={date(c.createdAt)} />
        </div>
        {!reveal && <p className="mt-3 text-[12px] text-k-muted">🔒 Documento/contactos tokenizados. Usa «Revelar PII» (requiere permiso `client:pii:read`, queda auditado).</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-k-text-2">Contactos ({c.contacts?.length ?? 0})</h2>
          <ul className="space-y-2 text-[14px]">
            {(c.contacts ?? []).map((ct) => (
              <li key={ct.id} className="flex items-center justify-between">
                <span><span className="text-k-text-2">{ct.contactType}:</span> <span className="font-mono text-[13px]">{ct.value ?? '—'}</span></span>
                {ct.isPrimary && <Badge tone="purple">primario</Badge>}
              </li>
            ))}
            {(c.contacts?.length ?? 0) === 0 && <li className="text-k-muted">Sin contactos.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-k-text-2">Ubicaciones ({c.locations?.length ?? 0})</h2>
          <ul className="space-y-2 text-[14px]">
            {(c.locations ?? []).map((l) => (
              <li key={l.id}><span className="text-k-text-2">{l.locationType}:</span> {l.address ?? '—'} {l.zone && <span className="text-k-muted">· {l.zone}</span>}</li>
            ))}
            {(c.locations?.length ?? 0) === 0 && <li className="text-k-muted">Sin ubicaciones.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-k-text-2">Red ({c.relations?.length ?? 0})</h2>
          <ul className="space-y-2 text-[14px]">
            {(c.relations ?? []).map((r) => (
              <li key={r.id}>{r.relatedName} <span className="text-k-muted">· {r.relationshipType}</span> {r.phone && <span className="font-mono text-[12px]">{r.phone}</span>}</li>
            ))}
            {(c.relations?.length ?? 0) === 0 && <li className="text-k-muted">Sin relaciones.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
