/**
 * Base local (P6). **El único archivo de la app que escribe SQL.** Ninguna pantalla ni service
 * arma una query: piden por estas funciones.
 *
 * Dos cosas viven acá y son MUY distintas:
 *
 * 1. **`cache`** — copia local de lo que el server ya sabe (cartera, ruta, agenda…). Es
 *    **descartable**: si el esquema cambia o los datos quedan viejos, se borra y se vuelve a bajar.
 *    Nunca es la fuente de verdad.
 * 2. **`queue`** — lo que el cobrador hizo y todavía NO llegó al server. Es **lo contrario de
 *    descartable**: puede ser un pago. No se borra por un cambio de versión, ni en el logout.
 *
 * `ponytail:` el `cache` es una sola tabla genérica (`kind` + `id` + el JSON del server), no ocho
 * tablas espejo. Motivo concreto: cuando el backend suma un campo, el JSON lo absorbe y **no hay
 * migración local**; y las pantallas ya ordenan y agrupan con funciones puras (`sortPortfolio`,
 * `groupPortfolio`, `partitionDay`), así que no hacía falta SQL rico. Lo que sí se conserva de
 * SQLite es lo que importa: leer una ficha sin cargar la cartera entera, e índices para filtrar.
 */
import * as SQLite from 'expo-sqlite';

/** Sube cuando cambia la forma de `cache`. Al no coincidir se borra el caché — nunca la cola. */
const SCHEMA_VERSION = 2;
const DB_NAME = 'kobrax.db';

/**
 * Qué guarda cada fila del caché.
 *
 * Los `*.detail` van aparte **porque no son la misma forma que su lista**: `AgendaItemDetail` es un
 * compuesto (gestión + deudor + saldo + historial), no un `AgendaListItem`. Bajo una sola clave, una
 * lectura de detalle devolvería a veces la fila de la lista y el objeto llegaría mutilado.
 * `route` no necesita split: el listado y el detalle son el mismo `RouteItem`.
 */
export type CacheKind =
  /** Quién es el cobrador (`GET /auth/me`). Sin esto, abrir la app sin señal no pasa del splash. */
  | 'session'
  | 'client'
  /** Lo que el alta de gestión necesita del cliente: créditos, teléfonos y direcciones. */
  | 'client.context'
  | 'case'
  | 'case.detail'
  | 'credit'
  | 'route'
  | 'agenda'
  | 'agenda.detail'
  | 'catalog'
  | 'notification'
  /** Los pagos del día: sin ellos, el cierre de jornada sin señal informaría cero cobrado. */
  | 'payment';

/** Qué espera subir la cola. Cada uno mapea a un endpoint idempotente o append-only (plan §D3). */
export type QueueKind =
  | 'visit'
  | 'payment'
  | 'agenda.create'
  | 'agenda.complete'
  | 'agenda.postpone'
  | 'case.activity'
  | 'route.status'
  | 'client.create'
  | 'credit.create';

export interface QueueRow {
  id: number;
  userId: string;
  kind: QueueKind;
  payload: string;
  idempotencyKey: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Abre (una vez) y garantiza el esquema. Todas las funciones de acá pasan por esto. */
function open(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cache (
        kind       TEXT    NOT NULL,
        scope      TEXT    NOT NULL DEFAULT '',
        id         TEXT    NOT NULL,
        json       TEXT    NOT NULL,
        fetched_at INTEGER NOT NULL,
        -- El scope entra en la clave porque una misma entidad vive en varias listas a la vez (un
        -- caso está en la cartera Y en el conteo del Home). Con PK (kind,id) la segunda lista
        -- le pisaba el scope a la primera y la entidad desaparecía de aquella.
        PRIMARY KEY (kind, scope, id)
      );
      CREATE INDEX IF NOT EXISTS idx_cache_scope ON cache (kind, scope);
      CREATE INDEX IF NOT EXISTS idx_cache_id ON cache (kind, id);
      CREATE TABLE IF NOT EXISTS queue (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         TEXT    NOT NULL,
        kind            TEXT    NOT NULL,
        payload         TEXT    NOT NULL,
        idempotency_key TEXT,
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    await ensureVersion(db);
    return db;
  })();
  return dbPromise;
}

/**
 * Si la versión del esquema no coincide, se tira el caché y se re-hidrata. **La cola se conserva
 * intacta**: es trabajo del cobrador sin entregar, no una copia de algo que el server ya tiene.
 */
async function ensureVersion(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  if (row?.value === String(SCHEMA_VERSION)) return;
  await db.runAsync('DELETE FROM cache');
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)]);
}

// ── Caché ─────────────────────────────────────────────────────────────────────

/**
 * Guarda un lote de un recurso. `scope` es la clave por la que después se filtra (la fecha de la
 * agenda, el id del cliente de un caso); `null` cuando el recurso se lee entero.
 */
/**
 * `ponytail:` **sin `withTransactionAsync` a propósito.** Envolver esto en una transacción provocó
 * un deadlock real: la hidratación y las pantallas escriben a la vez sobre la misma conexión, y dos
 * transacciones concurrentes se bloquean mutuamente — el Home se quedaba en el spinner para siempre.
 *
 * No se pierde nada: el caché es **descartable**. Si una escritura queda a medias, la próxima
 * hidratación la sobrescribe. La atomicidad importa donde hay dinero, y eso vive en `queue`, cuyas
 * operaciones son de una sola fila (atómicas por sí mismas).
 */
export async function putAll<T extends { id: string }>(
  kind: CacheKind,
  items: T[],
  scopeOf?: (item: T) => string | null,
): Promise<void> {
  if (items.length === 0) return;
  const db = await open();
  const now = Date.now();
  for (const item of items) {
    await db.runAsync('INSERT OR REPLACE INTO cache (kind, scope, id, json, fetched_at) VALUES (?, ?, ?, ?, ?)', [
      kind,
      scopeOf?.(item) ?? '',
      item.id,
      JSON.stringify(item),
      now,
    ]);
  }
}

/** Guarda un valor suelto que no tiene forma de entidad (el compuesto de un detalle, por ejemplo). */
export async function putOne(kind: CacheKind, id: string, value: unknown): Promise<void> {
  const db = await open();
  await db.runAsync('INSERT OR REPLACE INTO cache (kind, scope, id, json, fetched_at) VALUES (?, ?, ?, ?, ?)', [
    kind,
    '',
    id,
    JSON.stringify(value),
    Date.now(),
  ]);
}

/**
 * Una ficha por id, **sin importar de qué lista vino** — por eso no filtra por scope. Es lo que
 * permite abrir el detalle de un cliente que sólo se vio dentro de la cartera.
 */
export async function getOne<T>(kind: CacheKind, id: string): Promise<T | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM cache WHERE kind = ? AND id = ? ORDER BY fetched_at DESC LIMIT 1',
    [kind, id],
  );
  return row ? (JSON.parse(row.json) as T) : null;
}

/** Todo lo de un recurso, o sólo lo de un `scope` (la respuesta guardada de una consulta). */
export async function getMany<T>(kind: CacheKind, scope?: string): Promise<T[]> {
  const db = await open();
  const rows =
    scope === undefined
      ? await db.getAllAsync<{ json: string }>('SELECT json FROM cache WHERE kind = ?', [kind])
      : await db.getAllAsync<{ json: string }>('SELECT json FROM cache WHERE kind = ? AND scope = ?', [kind, scope]);
  return rows.map((r) => JSON.parse(r.json) as T);
}

/**
 * Cuándo se bajó este recurso, para que la UI pueda decir "datos de las 08:15" en vez de mentir
 * que están al día (riesgo R4 del plan). `null` = nunca se bajó.
 */
export async function fetchedAt(kind: CacheKind, scope?: string): Promise<number | null> {
  const db = await open();
  const row =
    scope === undefined
      ? await db.getFirstAsync<{ t: number }>('SELECT MAX(fetched_at) AS t FROM cache WHERE kind = ?', [kind])
      : await db.getFirstAsync<{ t: number }>('SELECT MAX(fetched_at) AS t FROM cache WHERE kind = ? AND scope = ?', [kind, scope]);
  return row?.t ?? null;
}

/** Reemplaza por completo un recurso (o un scope): lo que el server ya no manda, se va. */
export async function replaceAll<T extends { id: string }>(
  kind: CacheKind,
  items: T[],
  scope?: string,
  scopeOf?: (item: T) => string | null,
): Promise<void> {
  const db = await open();
  if (scope === undefined) await db.runAsync('DELETE FROM cache WHERE kind = ?', [kind]);
  else await db.runAsync('DELETE FROM cache WHERE kind = ? AND scope = ?', [kind, scope]);
  await putAll(kind, items, scopeOf ?? (() => scope ?? ''));
}

/** El logout borra la copia de datos del tenant. **No toca la cola** (plan §Q3). */
export async function clearCache(): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM cache');
}

// ── Cola ──────────────────────────────────────────────────────────────────────

/** Encola una acción. Devuelve su id, que es el orden FIFO real (no depende del reloj del equipo). */
export async function enqueue(input: {
  userId: string;
  kind: QueueKind;
  payload: unknown;
  idempotencyKey?: string;
}): Promise<number> {
  const db = await open();
  const res = await db.runAsync(
    'INSERT INTO queue (user_id, kind, payload, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?)',
    [input.userId, input.kind, JSON.stringify(input.payload), input.idempotencyKey ?? null, Date.now()],
  );
  return res.lastInsertRowId;
}

/** Lo pendiente de un cobrador, **en orden de inserción** (riesgo R5: nunca por timestamp). */
export async function pending(userId: string): Promise<QueueRow[]> {
  const db = await open();
  const rows = await db.getAllAsync<{
    id: number;
    user_id: string;
    kind: string;
    payload: string;
    idempotency_key: string | null;
    attempts: number;
    last_error: string | null;
    created_at: number;
  }>('SELECT * FROM queue WHERE user_id = ? ORDER BY id ASC', [userId]);
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    kind: r.kind as QueueKind,
    payload: r.payload,
    idempotencyKey: r.idempotency_key,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
  }));
}

/** Cuántas acciones esperan (alimenta el contador del `OfflineIndicator`). */
export async function pendingCount(userId: string): Promise<number> {
  const db = await open();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM queue WHERE user_id = ?', [userId]);
  return row?.n ?? 0;
}

/** Salió bien: recién ahí se borra de la cola. */
export async function dequeue(id: number): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM queue WHERE id = ?', [id]);
}

/** Falló: se cuenta el intento y se guarda el motivo. **El ítem NO se borra jamás por fallar.** */
export async function markFailed(id: number, error: string): Promise<void> {
  const db = await open();
  await db.runAsync('UPDATE queue SET attempts = attempts + 1, last_error = ? WHERE id = ?', [error, id]);
}

/** Sólo para los tests y el borrado de datos del dispositivo. */
export async function resetForTests(): Promise<void> {
  const db = await open();
  await db.execAsync('DELETE FROM cache; DELETE FROM queue; DELETE FROM meta;');
  dbPromise = null;
}
