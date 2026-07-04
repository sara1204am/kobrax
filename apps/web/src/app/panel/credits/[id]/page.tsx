import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiCall } from '@/lib/bff';
import { Badge, Card, EmptyRow, Field, PanelHeading, statusTone } from '@/components/panel';
import { date, money } from '@/lib/format';

interface Installment { id: string; number: number; dueDate: string; amount: number; principal: number; interest: number; paidAmount: number; status: string }
interface Arrear { id: string; daysOverdue: number; overdueAmount: number; interest: number; penalty: number; calculatedAt: string }
interface CreditDetail {
  id: string;
  code?: string;
  clientId: string;
  principalAmount: number;
  outstandingBalance: number;
  interestRate: number;
  currency: string;
  status: string;
  daysPastDue: number;
  installmentsCount: number;
  labels?: Record<string, string>;
  installments?: Installment[];
  arrears?: Arrear[];
}

function instTone(s: string) {
  return s === 'PAID' ? 'green' : s === 'OVERDUE' ? 'red' : s === 'PARTIAL' ? 'amber' : 'gray';
}

export default async function CreditDetailPage({ params }: { params: { id: string } }) {
  const { status, body } = await apiCall<CreditDetail>(`/credits/${params.id}`, { method: 'GET', auth: true });
  if (status === 404) notFound();
  const c = body.data;
  if (status !== 200 || !c) return <p className="text-[14px] text-k-danger">No se pudo cargar el crédito ({body.error?.code ?? status}).</p>;
  const L = c.labels ?? {};

  return (
    <>
      <Link href="/panel/credits" className="text-[13px] font-medium text-k-purple">← Créditos</Link>
      <PanelHeading
        title={c.code ?? c.id.slice(0, 8)}
        subtitle={<>Cliente <Link href={`/panel/clients/${c.clientId}`} className="font-mono text-k-purple hover:underline">{c.clientId.slice(0, 8)}…</Link></>}
        action={<Badge tone={statusTone(c.status)}>{c.status}</Badge>}
      />

      <Card className="mb-4 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label={L.principalAmount ?? 'Capital'} value={money(c.principalAmount, c.currency)} mono />
          <Field label={L.outstandingBalance ?? 'Saldo'} value={money(c.outstandingBalance, c.currency)} mono />
          <Field label={L.interestRate ?? 'Tasa'} value={`${(c.interestRate * 100).toFixed(2)}% / cuota`} />
          <Field label="Días de mora" value={<Badge tone={c.daysPastDue === 0 ? 'green' : c.daysPastDue <= 30 ? 'amber' : 'red'}>{c.daysPastDue}</Badge>} />
        </div>
      </Card>

      {(c.arrears?.length ?? 0) > 0 && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-k-text-2">Mora</h2>
          {(c.arrears ?? []).map((a) => (
            <div key={a.id} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Días" value={a.daysOverdue} />
              <Field label="Monto en mora" value={money(a.overdueAmount, c.currency)} mono />
              <Field label="Interés moratorio" value={money(a.interest, c.currency)} mono />
              <Field label="Penalización" value={money(a.penalty, c.currency)} mono />
            </div>
          ))}
        </Card>
      )}

      <Card className="overflow-hidden">
        <h2 className="px-4 pt-4 text-[13px] font-semibold uppercase tracking-wide text-k-text-2">Cronograma ({c.installmentsCount} cuotas)</h2>
        <table className="mt-3 w-full text-[14px]">
          <thead className="border-y border-k-border bg-k-bg text-left text-[12px] uppercase tracking-wide text-k-text-2">
            <tr>
              <th className="px-4 py-2 font-semibold">#</th>
              <th className="px-4 py-2 font-semibold">Vence</th>
              <th className="px-4 py-2 text-right font-semibold">Capital</th>
              <th className="px-4 py-2 text-right font-semibold">Interés</th>
              <th className="px-4 py-2 text-right font-semibold">Cuota</th>
              <th className="px-4 py-2 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-k-border font-mono text-[13px]">
            {(c.installments?.length ?? 0) === 0 && <EmptyRow cols={6} text="Sin cronograma." />}
            {(c.installments ?? []).map((i) => (
              <tr key={i.id} className={i.status === 'OVERDUE' ? 'bg-k-danger-bg/40' : ''}>
                <td className="px-4 py-2">{i.number}</td>
                <td className="px-4 py-2 text-k-text-2">{date(i.dueDate)}</td>
                <td className="px-4 py-2 text-right">{money(i.principal, c.currency)}</td>
                <td className="px-4 py-2 text-right">{money(i.interest, c.currency)}</td>
                <td className="px-4 py-2 text-right font-semibold">{money(i.amount, c.currency)}</td>
                <td className="px-4 py-2"><Badge tone={instTone(i.status)}>{i.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
