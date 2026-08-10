'use client';

/**
 * Red de contención de toda la app.
 *
 * `(panel)/error.tsx` atrapa lo que revienta **dentro** de una pantalla del panel, pero no lo
 * que revienta en el layout que lo envuelve: Next monta Layout → ErrorBoundary → Page, así que
 * un error del layout pasa por encima de su propio boundary. Sin este archivo, eso terminaba
 * en la pantalla en blanco de Next («Application error»), sin shell y sin salida.
 *
 * Es a propósito el más tonto posible: no usa i18n ni componentes del panel, porque lo que
 * acaba de fallar puede ser justamente eso.
 */
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-k-bg px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[20px] font-semibold text-k-navy">Algo salió mal</h1>
        <p className="mt-2 text-[14px] text-k-text-2">
          No pudimos cargar esta pantalla.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-k-navy px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-k-slate"
          >
            Reintentar
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-k-border bg-white px-4 py-2.5 text-[14px] font-medium text-k-text-2 hover:bg-k-bg"
          >
            Ir al inicio
          </a>
        </div>
      </div>
    </main>
  );
}
