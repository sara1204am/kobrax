'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { defaultPeriod } from '@/lib/payments';

/**
 * El período del ledger: dos fechas en la URL.
 *
 * No reusa el `DayPicker` a propósito: ése mira **un día** y navega de a uno, que es lo que sirve
 * para una jornada de campo. Un ledger se lee por rango, y flechitas de a un día para recorrer un
 * mes serían treinta clics.
 */
export function PeriodPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useTranslations('panel.payments');
  const period = defaultPeriod();

  function set(key: 'from' | 'to', value: string) {
    if (!value) return;
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    // Cambiar el período cambia qué filas existen: volver a la primera página.
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Day label={t('from')} value={params.get('from') ?? period.from} onChange={(v) => set('from', v)} />
      <Day label={t('to')} value={params.get('to') ?? period.to} onChange={(v) => set('to', v)} />
    </div>
  );
}

function Day({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
      />
    </label>
  );
}
