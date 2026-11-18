import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlatformConsole, type PlatformAccount, type PlatformReport } from '@/components/platform-console';
import { platformCall, platformToken } from '@/lib/platform-bff';

/** La consola no se indexa ni se enlaza desde ninguna parte pública. */
export const metadata: Metadata = { title: 'Kobrax · Plataforma', robots: { index: false, follow: false } };

/**
 * Consola de PLATAFORMA: la bandeja de reportes y solicitudes de derechos, y la búsqueda de cuentas para suspender o reactivar.
 * Sin cookie de plataforma —o con el token vencido o el acceso apagado en el servidor— se manda al ingreso. Toda la autorización real la hace
 * la API (`platform:*`): esta pantalla solo no pinta lo que la API no entregó.
 */
export default async function PlatformPage() {
  if (!platformToken()) redirect('/plataforma/login');
  const [reports, accounts] = await Promise.all([
    platformCall<PlatformReport[]>('/platform/privacy-requests', { method: 'GET' }),
    platformCall<PlatformAccount[]>('/platform/accounts?q=', { method: 'GET' }),
  ]);
  if (reports.body.error?.code === 'PLATFORM_DISABLED' || accounts.body.error?.code === 'PLATFORM_DISABLED') redirect('/plataforma/login?e=disabled');
  if ([reports.status, accounts.status].some((s) => s === 401 || s === 403)) redirect('/plataforma/login?e=expired');
  return <PlatformConsole initialReports={reports.body.data ?? []} initialAccounts={accounts.body.data ?? []} />;
}
