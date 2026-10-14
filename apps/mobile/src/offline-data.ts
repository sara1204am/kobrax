/**
 * Qué hay en el teléfono para trabajar sin señal, dicho en cosas que el cobrador entiende.
 *
 * Existe porque la hidratación corre callada al abrir la app y, si falla a medias, nadie lo sabe hasta
 * que está en la calle y las pantallas dicen «Sin conexión». Esto lo hace visible ANTES de salir.
 *
 * No baja nada ni escribe: sólo cuenta lo que `sync/hydrate` ya dejó en la base local.
 */
import * as db from './db';
import type { CacheKind } from './db';
import type { HydrateStep } from './sync/hydrate';

export interface InventoryRow {
  key: string;
  label: string;
  count: number;
}

/** Lo que se cuenta. El orden es el de la pantalla. */
const ITEMS: { kind: CacheKind; label: string }[] = [
  { kind: 'portfolio', label: 'Créditos de tu cartera' },
  { kind: 'client', label: 'Fichas de clientes' },
  { kind: 'mora.detail', label: 'Fichas de mora' },
  { kind: 'agenda', label: 'Gestiones de la agenda' },
  { kind: 'agenda.detail', label: 'Detalle de gestiones' },
  { kind: 'route', label: 'Rutas' },
  { kind: 'catalog', label: 'Catálogos (motivos, medios de pago…)' },
];

export async function offlineInventory(): Promise<InventoryRow[]> {
  const rows: InventoryRow[] = [];
  for (const it of ITEMS) rows.push({ key: it.kind, label: it.label, count: await db.countKind(it.kind) });
  return rows;
}

/** Cuándo se bajó la cartera por última vez (la referencia de «qué tan frescos están los datos»). `null` = nunca. */
export function lastDownloadAt(): Promise<number | null> {
  return db.fetchedAt('portfolio');
}

/** Texto corto de un paso para la lista de progreso. */
export function stepDetail(step: HydrateStep): string {
  if (step.state === 'running') return step.total ? `${step.done ?? 0} de ${step.total}` : 'Descargando…';
  if (step.state === 'ok') return step.total ? `${step.done ?? step.total} de ${step.total}` : 'Listo';
  if (step.state === 'offline') return 'Sin señal';
  return 'No se pudo bajar';
}

/** «hoy 14:32», «ayer 09:10» o «hace 3 días» — sin depender del formato regional del teléfono. */
export function whenDownloaded(ts: number | null, now: Date = new Date()): string {
  if (ts == null) return 'Nunca';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dayMs = 86_400_000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return `hoy ${hh}:${mm}`;
  if (ts >= startToday - dayMs) return `ayer ${hh}:${mm}`;
  const dias = Math.floor((startToday - ts) / dayMs) + 1;
  return `hace ${dias} días`;
}
