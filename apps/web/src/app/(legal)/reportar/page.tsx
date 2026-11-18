import { PublicReportPage } from '@/components/public-report-page';

/** Formulario público para reportar hostigamiento o datos cargados sin derecho, o pedir acceso, corrección o eliminación. Sin sesión. */
export default function ReportarPage() {
  return <PublicReportPage mode="report" />;
}
