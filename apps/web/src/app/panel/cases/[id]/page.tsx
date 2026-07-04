import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiCall } from '@/lib/bff';
import { Badge, Card, Field, PanelHeading, priorityTone, statusTone } from '@/components/panel';
import { dateTime } from '@/lib/format';

interface Activity { id: string; type: string; result?: string; notes?: string; createdAt: string }
interface CaseDetail {
  id: string;
  creditId: string;
  clientId: string;
  status: string;
  priority: string;
  slaDueAt?: string;
  isOverdue: boolean;
  assigneeId?: string;
  lastActionAt?: string;
  closedReason?: string;
  createdAt: string;
  activities?: Activity[];
}

const ACTIVITY_ICON: Record<string, string> = {
  NOTE: '📝', CALL: '📞', VISIT: '📍', PAYMENT: '💰', STATUS_CHANGE: '🔁', ASSIGNMENT: '👤', MESSAGE: '💬',
};

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  const { status, body } = await apiCall<CaseDetail>(`/cases/${params.id}`, { method: 'GET', auth: true });
  if (status === 404) notFound();
  const c = body.data;
  if (status !== 200 || !c) return <p className="text-[14px] text-k-danger">No se pudo cargar el caso ({body.error?.code ?? status}).</p>;

  return (
    <>
      <Link href="/panel/cases" className="text-[13px] font-medium text-k-purple">← Casos</Link>
      <PanelHeading
        title={`Caso ${c.id.slice(0, 8)}`}
        subtitle={<>Crédito <Link href={`/panel/credits/${c.creditId}`} className="font-mono text-k-purple hover:underline">{c.creditId.slice(0, 8)}…</Link> · Cliente <Link href={`/panel/clients/${c.clientId}`} className="font-mono text-k-purple hover:underline">{c.clientId.slice(0, 8)}…</Link></>}
        action={<div className="flex gap-2"><Badge tone={priorityTone(c.priority)}>{c.priority}</Badge><Badge tone={statusTone(c.status)}>{c.status}</Badge></div>}
      />

      <Card className="mb-4 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="SLA" value={c.isOverdue ? <Badge tone="red">vencido · {dateTime(c.slaDueAt)}</Badge> : dateTime(c.slaDueAt)} />
          <Field label="Asignado a" value={c.assigneeId ? <span className="font-mono text-[12px]">{c.assigneeId.slice(0, 8)}…</span> : 'sin asignar'} />
          <Field label="Última gestión" value={dateTime(c.lastActionAt)} />
          <Field label="Creado" value={dateTime(c.createdAt)} />
        </div>
        {c.closedReason && <p className="mt-3 text-[13px] text-k-text-2">Motivo de cierre: <span className="font-medium text-k-text">{c.closedReason}</span></p>}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-k-text-2">Bitácora ({c.activities?.length ?? 0})</h2>
        <ol className="relative space-y-4 border-l-2 border-k-border pl-5">
          {(c.activities ?? []).map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px]">{ACTIVITY_ICON[a.type] ?? '•'}</span>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-k-text">{a.type}</span>
                {a.result && <Badge tone="blue">{a.result}</Badge>}
                <span className="text-[11px] text-k-muted">{dateTime(a.createdAt)}</span>
              </div>
              {a.notes && <p className="mt-0.5 text-[13px] text-k-text-2">{a.notes}</p>}
            </li>
          ))}
          {(c.activities?.length ?? 0) === 0 && <li className="text-[13px] text-k-muted">Sin gestiones registradas.</li>}
        </ol>
      </Card>
    </>
  );
}
