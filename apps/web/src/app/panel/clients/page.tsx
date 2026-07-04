import Link from 'next/link';
import { apiCall } from '@/lib/bff';
import { Badge, Card, EmptyRow, PanelHeading, Pagination, statusTone } from '@/components/panel';
import { date, fullName } from '@/lib/format';

interface ClientRow {
  id: string;
  clientType: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId?: string;
  status: string;
  riskSegment?: string;
  createdAt: string;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; status?: string };
}) {
  const params = new URLSearchParams({ limit: '20', page: searchParams.page ?? '1' });
  if (searchParams.q) params.set('q', searchParams.q);
  if (searchParams.status) params.set('status', searchParams.status);

  const { status, body } = await apiCall<ClientRow[]>(`/clients?${params}`, { method: 'GET', auth: true });
  const rows = status === 200 ? body.data ?? [] : [];
  const baseHref = `/panel/clients?${new URLSearchParams({ ...(searchParams.q ? { q: searchParams.q } : {}), ...(searchParams.status ? { status: searchParams.status } : {}) })}`;

  return (
    <>
      <PanelHeading title="Clientes" subtitle="Maestro de deudores · documento tokenizado por privacidad" />

      <form method="GET" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={searchParams.q ?? ''}
          placeholder="Buscar por documento o nombre…"
          className="h-10 w-72 rounded-[10px] border-[1.5px] border-k-light-bg px-3 text-[14px] outline-none focus:border-k-periwinkle"
        />
        <select name="status" defaultValue={searchParams.status ?? ''} className="h-10 rounded-[10px] border-[1.5px] border-k-light-bg px-3 text-[14px]">
          <option value="">Todos</option>
          <option value="ACTIVE">Activos</option>
          <option value="INACTIVE">Inactivos</option>
          <option value="BLOCKED">Bloqueados</option>
        </select>
        <button className="h-10 rounded-[10px] bg-k-navy px-4 text-[14px] font-medium text-white hover:bg-k-slate">Buscar</button>
      </form>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="border-b border-k-border bg-k-bg text-left text-[12px] uppercase tracking-wide text-k-text-2">
            <tr>
              <th className="px-4 py-3 font-semibold">Nombre</th>
              <th className="px-4 py-3 font-semibold">Documento</th>
              <th className="px-4 py-3 font-semibold">Tipo</th>
              <th className="px-4 py-3 font-semibold">Riesgo</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Alta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-k-border">
            {rows.length === 0 && <EmptyRow cols={6} text="Sin clientes." />}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-k-bg">
                <td className="px-4 py-3">
                  <Link href={`/panel/clients/${c.id}`} className="font-medium text-k-purple hover:underline">
                    {fullName(c)}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-k-text-2">{c.nationalId ?? '—'}</td>
                <td className="px-4 py-3 text-k-text-2">{c.clientType === 'COMPANY' ? 'Empresa' : 'Persona'}</td>
                <td className="px-4 py-3">{c.riskSegment ? <Badge tone={c.riskSegment === 'HIGH' ? 'red' : c.riskSegment === 'MEDIUM' ? 'amber' : 'gray'}>{c.riskSegment}</Badge> : '—'}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                <td className="px-4 py-3 text-k-text-2">{date(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination meta={body.meta} baseHref={baseHref} />
      </Card>
    </>
  );
}
