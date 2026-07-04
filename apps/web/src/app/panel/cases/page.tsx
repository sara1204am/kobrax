import Link from 'next/link';
import { apiCall } from '@/lib/bff';
import { Badge, Card, EmptyRow, PanelHeading, Pagination, priorityTone, statusTone } from '@/components/panel';
import { dateTime } from '@/lib/format';

interface CaseRow {
  id: string;
  creditId: string;
  clientId: string;
  status: string;
  priority: string;
  slaDueAt?: string;
  isOverdue: boolean;
  assigneeId?: string;
  createdAt: string;
}

export default async function CasesPage({ searchParams }: { searchParams: { page?: string; status?: string; priority?: string; overdue?: string } }) {
  const params = new URLSearchParams({ limit: '20', page: searchParams.page ?? '1' });
  if (searchParams.status) params.set('status', searchParams.status);
  if (searchParams.priority) params.set('priority', searchParams.priority);
  if (searchParams.overdue) params.set('overdue', searchParams.overdue);

  const { status, body } = await apiCall<CaseRow[]>(`/cases?${params}`, { method: 'GET', auth: true });
  const rows = status === 200 ? body.data ?? [] : [];
  const keep = { ...(searchParams.status ? { status: searchParams.status } : {}), ...(searchParams.priority ? { priority: searchParams.priority } : {}), ...(searchParams.overdue ? { overdue: searchParams.overdue } : {}) };
  const baseHref = `/panel/cases?${new URLSearchParams(keep)}`;

  return (
    <>
      <PanelHeading title="Casos de cobranza" subtitle="Cartera operativa · ordenada por prioridad" />

      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <select name="status" defaultValue={searchParams.status ?? ''} className="h-10 rounded-[10px] border-[1.5px] border-k-light-bg px-3 text-[14px]">
          <option value="">Todos los estados</option>
          {['PENDING', 'ACTIVE', 'IN_NEGOTIATION', 'PROMISE_TO_PAY', 'PAID', 'CLOSED', 'WRITTEN_OFF'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="priority" defaultValue={searchParams.priority ?? ''} className="h-10 rounded-[10px] border-[1.5px] border-k-light-bg px-3 text-[14px]">
          <option value="">Toda prioridad</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-k-text-2"><input type="checkbox" name="overdue" value="true" defaultChecked={searchParams.overdue === 'true'} /> Solo vencidos (SLA)</label>
        <button className="h-10 rounded-[10px] bg-k-navy px-4 text-[14px] font-medium text-white hover:bg-k-slate">Filtrar</button>
      </form>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="border-b border-k-border bg-k-bg text-left text-[12px] uppercase tracking-wide text-k-text-2">
            <tr>
              <th className="px-4 py-3 font-semibold">Caso</th>
              <th className="px-4 py-3 font-semibold">Crédito</th>
              <th className="px-4 py-3 font-semibold">Prioridad</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">SLA</th>
              <th className="px-4 py-3 font-semibold">Asignado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-k-border">
            {rows.length === 0 && <EmptyRow cols={6} text="Sin casos. Genera desde la API (POST /cases/generate)." />}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-k-bg">
                <td className="px-4 py-3"><Link href={`/panel/cases/${c.id}`} className="font-mono text-[12px] font-medium text-k-purple hover:underline">{c.id.slice(0, 8)}…</Link></td>
                <td className="px-4 py-3"><Link href={`/panel/credits/${c.creditId}`} className="font-mono text-[12px] text-k-text-2 hover:underline">{c.creditId.slice(0, 8)}…</Link></td>
                <td className="px-4 py-3"><Badge tone={priorityTone(c.priority)}>{c.priority}</Badge></td>
                <td className="px-4 py-3"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                <td className="px-4 py-3">{c.isOverdue ? <Badge tone="red">vencido</Badge> : <span className="text-k-text-2">{dateTime(c.slaDueAt)}</span>}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-k-text-2">{c.assigneeId ? `${c.assigneeId.slice(0, 8)}…` : <span className="text-k-muted">sin asignar</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination meta={body.meta} baseHref={baseHref} />
      </Card>
    </>
  );
}
