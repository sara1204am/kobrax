import Link from 'next/link';
import { apiCall } from '@/lib/bff';
import { Badge, Card, EmptyRow, PanelHeading, Pagination, statusTone } from '@/components/panel';
import { money } from '@/lib/format';

interface CreditRow {
  id: string;
  code?: string;
  clientId: string;
  principalAmount: number;
  outstandingBalance: number;
  currency: string;
  status: string;
  daysPastDue: number;
  installmentsCount: number;
}

function dpdTone(d: number) {
  if (d === 0) return 'green';
  if (d <= 30) return 'amber';
  return 'red';
}

export default async function CreditsPage({ searchParams }: { searchParams: { page?: string; status?: string } }) {
  const params = new URLSearchParams({ limit: '20', page: searchParams.page ?? '1' });
  if (searchParams.status) params.set('status', searchParams.status);

  const { status, body } = await apiCall<CreditRow[]>(`/credits?${params}`, { method: 'GET', auth: true });
  const rows = status === 200 ? body.data ?? [] : [];
  const baseHref = `/panel/credits?${new URLSearchParams(searchParams.status ? { status: searchParams.status } : {})}`;

  return (
    <>
      <PanelHeading title="Créditos" subtitle="Obligaciones financieras · cronograma y mora" />

      <form method="GET" className="mb-4 flex gap-2">
        <select name="status" defaultValue={searchParams.status ?? ''} className="h-10 rounded-[10px] border-[1.5px] border-k-light-bg px-3 text-[14px]">
          <option value="">Todos los estados</option>
          <option value="ACTIVE">Activos</option>
          <option value="PAID">Pagados</option>
          <option value="DEFAULTED">En default</option>
          <option value="WRITTEN_OFF">Castigados</option>
        </select>
        <button className="h-10 rounded-[10px] bg-k-navy px-4 text-[14px] font-medium text-white hover:bg-k-slate">Filtrar</button>
      </form>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="border-b border-k-border bg-k-bg text-left text-[12px] uppercase tracking-wide text-k-text-2">
            <tr>
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 text-right font-semibold">Capital</th>
              <th className="px-4 py-3 text-right font-semibold">Saldo</th>
              <th className="px-4 py-3 text-center font-semibold">Cuotas</th>
              <th className="px-4 py-3 text-center font-semibold">Días mora</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-k-border">
            {rows.length === 0 && <EmptyRow cols={7} text="Sin créditos." />}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-k-bg">
                <td className="px-4 py-3">
                  <Link href={`/panel/credits/${c.id}`} className="font-medium text-k-purple hover:underline">{c.code ?? c.id.slice(0, 8)}</Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/panel/clients/${c.clientId}`} className="font-mono text-[12px] text-k-text-2 hover:underline">{c.clientId.slice(0, 8)}…</Link>
                </td>
                <td className="px-4 py-3 text-right font-mono text-[13px]">{money(c.principalAmount, c.currency)}</td>
                <td className="px-4 py-3 text-right font-mono text-[13px]">{money(c.outstandingBalance, c.currency)}</td>
                <td className="px-4 py-3 text-center text-k-text-2">{c.installmentsCount}</td>
                <td className="px-4 py-3 text-center"><Badge tone={dpdTone(c.daysPastDue)}>{c.daysPastDue}</Badge></td>
                <td className="px-4 py-3"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination meta={body.meta} baseHref={baseHref} />
      </Card>
    </>
  );
}
