'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ledgerMethodOf, PAYMENT_METHODS, type PaymentMethod } from '@kobrax/shared';

export interface PaymentMethodOption {
  /** El código del catálogo del negocio (lo que se elige y lo que validan las promesas). */
  code: string;
  label: string;
  /** Con qué método del libro de pagos se registra (`payments.method`, un enum cerrado). */
  ledger: PaymentMethod;
}

/**
 * Los medios de pago que el negocio configuró (Cuenta → Catálogos), listos para un selector.
 *
 * El catálogo es el vocabulario del negocio; el libro de pagos es un enum cerrado que alimenta los reportes. Cada medio
 * trae el método del libro con el que se registra (`ledgerMethodOf`), y un pago se manda con **ese**, no con el código.
 * Los medios cuyo método no está decidido no se ofrecen: no se adivina uno.
 *
 * `options` nunca queda vacío: mientras carga, o si el catálogo no responde o está vacío, ofrece los métodos del libro.
 * `catalogOptions` es sólo lo que vino del catálogo (vacío hasta que llegue), para lo que se valida contra él.
 */
export function usePaymentMethods(enabled = true) {
  const tMethod = useTranslations('panel.payments.method');
  const [items, setItems] = useState<{ code: string; label: string; metadata?: object | null }[] | null>(null);

  useEffect(() => {
    if (!enabled || items !== null) return;
    void fetch('/api/catalogs/PAYMENT_METHOD')
      .then((r) => r.json())
      .then((b) => setItems(Array.isArray(b?.data) ? b.data : []))
      .catch(() => setItems([]));
  }, [enabled, items]);

  return useMemo(() => {
    const catalogOptions: PaymentMethodOption[] = (items ?? []).flatMap((i) => {
      const ledger = ledgerMethodOf(i);
      return ledger ? [{ code: i.code, label: i.label, ledger }] : [];
    });
    const options: PaymentMethodOption[] =
      catalogOptions.length > 0 ? catalogOptions : PAYMENT_METHODS.map((m) => ({ code: m, label: tMethod(m), ledger: m }));
    return {
      options,
      catalogOptions,
      /** El método del libro para un código elegido; `null` si ya no está en la lista. */
      ledgerOf: (code: string): PaymentMethod | null => options.find((o) => o.code === code)?.ledger ?? null,
    };
  }, [items, tMethod]);
}
