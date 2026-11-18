import { PublicReportPage } from '@/components/public-report-page';

/** URL pública para pedir la eliminación de la cuenta sin abrir la app (exigencia de Google Play). Sin sesión. */
export default function EliminarCuentaPage() {
  return <PublicReportPage mode="deletion" />;
}
