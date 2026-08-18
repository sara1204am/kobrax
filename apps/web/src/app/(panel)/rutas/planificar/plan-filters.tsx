'use client';

import { CasePriority, CaseStatus, VisitOutcome } from '@kobrax/shared';
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
  /** Los rótulos de estado y prioridad, de donde vive ese dominio: Mora. */
  tCases: (key: string) => string,
  /** Los de resultado de visita, de la ficha de la ruta. Una segunda copia sería otra fuente de verdad. */
  tRoutes: (key: string) => string,
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
    {
      keys: ['estado'],
      label: t('status'),
      type: 'multiSelect',
      // Plegado: siete estados, cuatro prioridades y diez resultados desplegados empujan fuera de
      // la pantalla a los que se usan todos los días.
      collapsed: true,
      options: Object.values(CaseStatus).map((s) => ({ value: s, label: tCases(`status.${s}`) })),
    },
    {
      keys: ['prioridad'],
      label: t('priority'),
      type: 'multiSelect',
      // Plegado: siete estados, cuatro prioridades y diez resultados desplegados empujan fuera de
      // la pantalla a los que se usan todos los días.
      collapsed: true,
      options: Object.values(CasePriority).map((p) => ({ value: p, label: tCases(`priority.${p}`) })),
    },
    {
      keys: ['resultado'],
      label: t('outcome'),
      type: 'multiSelect',
      // Plegado: siete estados, cuatro prioridades y diez resultados desplegados empujan fuera de
      // la pantalla a los que se usan todos los días.
      collapsed: true,
      options: Object.values(VisitOutcome).map((o) => ({ value: o, label: tRoutes(`outcome.${o}`) })),
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
  'estado',
  'prioridad',
  'resultado',
  'q',
];
