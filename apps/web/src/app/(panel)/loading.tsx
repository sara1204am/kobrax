import { Skeleton } from '@/components/panel-ui';

/**
 * Lo que se ve mientras el server component de la pantalla trae sus datos. Es el mecanismo
 * nativo de Next por segmento: no hace falta un `<Suspense>` a mano en cada página.
 */
export default function PanelLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
