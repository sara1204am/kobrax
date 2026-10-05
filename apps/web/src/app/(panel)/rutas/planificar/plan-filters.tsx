'use client';

import { COLLECTION_PRIORITIES, VisitOutcome } from '@kobrax/shared';
import type { FilterDef } from '@/components/data-table-filters';
import { DPD_RANGES, VISIT_AGES } from '@/lib/plan';

/**
 * Los filtros de la mora que se puede asignar, **en el mismo panel lateral que el resto del panel**.
 *
 * 🔴 No es un desplegable propio: es el `FilterPanel` que ya usan cartera, mora, rutas, pagos y
 * equipo. Un sexto lugar donde los filtros viven distinto obliga a aprender la pantalla de nuevo, y
 * era justo lo que se acababa de unificar.
 *
 * Acá va **sólo qué se filtra**; qué significa cada clave lo decide `lib/plan.ts`, y cómo se dibuja
 * cada control, `data-table-filters.tsx`. Ni una línea de negocio en el medio.
 */
export function planFilterDefs(
  t: (key: string) => string,
  /**
   * Las categorías de mora que configuró la cuenta (`GET /arrear-categories`). Vacío = el filtro no se
   * dibuja: no hay nada que elegir.
   */
  categories: { code: string; name: string }[] = [],
  /** Los de resultado de visita, de la ficha de la ruta (`panel.routes.outcome`): una sola fuente de verdad. */
  tOutcome: (key: string) => string = (k) => k,
): FilterDef[] {
  return [
    {
      /*
       * 🔴 Primero, y es a propósito: «ayudar a otro» cambia **de quién** es la mora que se ve, no
       * cuál. Abajo del todo se leería como un filtro más y es la decisión más grande del panel.
       */
      keys: ['cartera'],
      label: t('help'),
      type: 'radio',
      allLabel: t('onlyOwn'),
      options: [{ value: 'todos', label: t('allPortfolios') }],
    },
    {
      keys: ['dpd'],
      label: t('dpd'),
      type: 'select',
      allLabel: t('any'),
      options: DPD_RANGES.map((r) => ({ value: r, label: t(`dpdRanges.${r}`) })),
    },
    {
      keys: ['sort'],
      label: t('sort'),
      type: 'select',
      allLabel: t('sorts.priority'),
      options: ['daysPastDue', 'balance', 'createdAt'].map((s) => ({ value: s, label: t(`sorts.${s}`) })),
    },
    { keys: ['zona'], label: t('zone'), type: 'text' },
    { keys: ['saldoMin', 'saldoMax'], label: t('balance'), type: 'numberRange' },
    {
      keys: ['visita'],
      label: t('lastVisit'),
      type: 'select',
      allLabel: t('any'),
      options: VISIT_AGES.map((v) => ({ value: v, label: t(`visitAges.${v}`) })),
    },
    {
      keys: ['promesa'],
      label: t('promise'),
      type: 'radio',
      allLabel: t('any'),
      options: [
        { value: 'true', label: t('withPromise') },
        { value: 'false', label: t('withoutPromise') },
      ],
    },
    // F4/08: la categoría de mora (A/B/C…, configurable) reemplaza al estado del caso.
    ...(categories.length > 0
      ? [
          {
            keys: ['categoria'],
            label: t('category'),
            type: 'multiSelect' as const,
            // Plegado: las categorías y las prioridades desplegadas empujan fuera de la pantalla a
            // los filtros que se usan todos los días.
            collapsed: true,
            options: categories.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })),
          },
        ]
      : []),
    {
      keys: ['prioridad'],
      label: t('priority'),
      type: 'multiSelect',
      // La prioridad es la del EPISODIO de mora abierto.
      collapsed: true,
      options: COLLECTION_PRIORITIES.map((p) => ({ value: p, label: t(`priorities.${p}`) })),
    },
    {
      keys: ['resultado'],
      label: t('outcome'),
      type: 'multiSelect',
      // Plegado: prioridades y diez resultados desplegados empujan fuera de la pantalla a los de uso diario.
      collapsed: true,
      options: Object.values(VisitOutcome).map((o) => ({ value: o, label: tOutcome(o) })),
    },
  ];
}

/** Las claves que estos filtros escriben en la URL. De acá sale el «¿hay filtros puestos?». */
export const PLAN_FILTER_KEYS = [
  'cartera',
  'dpd',
  'sort',
  'zona',
  'saldoMin',
  'saldoMax',
  'visita',
  'promesa',
  'categoria',
  'prioridad',
  'resultado',
  'q',
];
