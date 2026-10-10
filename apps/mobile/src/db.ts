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

/**
 * Sube cuando cambia la forma de `cache` o de la cola. Al no coincidir se borra el caché **y la cola**.
 *
 * 3 (F4/08 · sin caso): desaparecen los tipos de caché `case`/`case.detail` y de cola `case.activity`, y las
 * acciones pierden el `caseId`. **Alcance dev-only: no hay teléfonos con colas reales**, así que no se migra
 * nada — se descarta (decisión confirmada 2026-10-03). Antes de la versión 3 la cola sobrevivía a todo cambio.
 */
export const SCHEMA_VERSION = 3;
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
  /**
   * La cartera del cobrador: TODOS sus créditos, al día o en mora (`GET /mora?todos=true`, paginado y
   * guardado junto). Una fila por crédito; el `id` es el crédito. Alimenta Cobranza, Rutas y la búsqueda sin señal.
   */
  | 'portfolio'
  /** Los créditos en mora del cobrador (`GET /mora`). Una fila por crédito; el `id` es el crédito. */
  | 'mora'
  /** La ficha de recuperación de un crédito (`GET /mora/:creditId`): compuesto, no la fila de la lista. */
  | 'mora.detail'
  /** Las promesas de un crédito en mora (`scope` = el crédito). */
  | 'mora.promises'
  /** Las notas de un crédito en mora (`scope` = el crédito). */
  | 'mora.notes'
  | 'credit'
  | 'route'
  | 'agenda'
  | 'agenda.detail'
  | 'catalog'
  | 'notification'
  /** Los pagos del día: sin ellos, el cierre de jornada sin señal informaría cero cobrado. */
  | 'payment'
  /**
   * El `meta.total` de una lista paginada (`id` = `<kind>|<scope>`). Sin esto, sin señal el total se
   * degradaba al largo de lo guardado (`limit=1` → «1 vencida» aunque haya 40). Vive en `cache`, así que
   * se borra junto con el resto en el logout.
   */
  | 'list.meta'
  /** Historial de importaciones (`scope`: `list` o `items:<corrida>:<acción>`; el detalle de una corrida, `detail:<id>`). */
  | 'import.run'
  /**
   * La cuenta con sus topes y su consumo (`GET /accounts/me`).
   *
   * Se guarda **para poder avisar sin señal**: el cobrador que da de alta un préstamo en la puerta
   * del deudor tiene que enterarse ahí de que el plan está lleno, no tres horas después cuando la
   * cola falle. Sin caché, el aviso sólo existiría con internet — justo cuando no hace falta.
   */
  | 'account'
  /** Paridad de la ficha de mora (F4/08 fase 5): historial de episodios (`scope` = crédito). */
  | 'mora.episodes'
  /** Métricas de recuperación de un crédito (`id` = crédito). */
  | 'mora.metrics'
  /** Rangos de categoría de mora de la cuenta (`GET /arrear-categories`): opciones del filtro. */
  | 'arrear.categories'
  /** Miembros del equipo (`GET /users`): nombres de quien registró / asignó, cuando el rol puede leerlos. */
  | 'members';

/** Qué espera subir la cola. Cada uno mapea a un endpoint idempotente o append-only (plan §D3). */
export type QueueKind =
  | 'visit'
  | 'payment'
  | 'agenda.create'
  | 'agenda.complete'
  | 'agenda.postpone'
  | 'route.status'
  /** Cambiar la dirección de una parada (valor fijo: repetirlo es un no-op en el servidor). */
  | 'route.stop.location'
  | 'client.create'
  | 'credit.create'
  /** Marcar en mora y poner al día. Ver `queue.ts`: «poner al día» viaja con la fecha ya resuelta. */
  | 'arrears.mark'
  | 'arrears.clear'
  | 'agenda.cancel'
  /** Editar y eliminar una gestión (`PATCH` / `DELETE /agenda/:id`): de valores fijos, reintentables. */
  | 'agenda.update'
  | 'agenda.delete'
  | 'agenda.reschedule'
  /** Gestión con resultado y promesa sobre un crédito, esté o no en mora (`POST /mora/:id/activities`). */
  | 'mora.activity'
  /** Nota de un crédito (`POST /mora/:id/notes`). */
  | 'credit.note'
  /** Fijar o soltar la prioridad de un crédito en mora (valor fijo). */
  | 'mora.priority'
  /** Foto de una visita que ya está en el server pero cuya evidencia no pudo adjuntarse (parte suelta de `visit`). */
  | 'visit.evidence'
  /** Aviso persistente: una foto que debía viajar ya no estaba en el teléfono. Sólo se puede descartar. */
  | 'photo.lost'
  /** Ediciones de la ficha del cliente: valores fijos (PATCH) o altas con búsqueda previa, repetibles sin duplicar. */
  | 'client.update'
  | 'client.contact'
  | 'client.location';

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
 * Si la versión del esquema no coincide, se tira el caché Y LA COLA (y los mapas de ids locales de `meta`, que
 * sólo tienen sentido con su cola) y se re-hidrata. Es una decisión dev-only (F4/08): no hay teléfonos con trabajo
 * real sin entregar, y migrar los ítems con `caseId` a su forma por crédito no vale el código. Con teléfonos
 * reales habría que volver a una migración de la cola ANTES de subir la versión.
 *
 * Una base nueva (sin `schema_version`) no tiene nada que borrar, pero el borrado es inocuo.
 */
async function ensureVersion(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  if (row?.value === String(SCHEMA_VERSION)) return;
  await db.runAsync('DELETE FROM cache');
  await db.runAsync('DELETE FROM queue');
  await db.runAsync('DELETE FROM meta');
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

/** Borra una fila del caché por id (todas sus consultas). Sólo para deshacer una fila provisional. */
export async function removeOne(kind: CacheKind, id: string): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM cache WHERE kind = ? AND id = ?', [kind, id]);
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

/** El logout borra la copia de datos del tenant. **No toca la cola** (plan §Q3): sólo el cambio de esquema la borra. */
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

/**
 * Reescribe el payload de una fila. Lo usa la cola para **persistir los ids** que genera al primer envío de un
 * ítem viejo (guardado sin id): si el envío se corta, el reintento reusa ESE id y no duplica.
 */
export async function updatePayload(id: number, payload: unknown): Promise<void> {
  const db = await open();
  await db.runAsync('UPDATE queue SET payload = ? WHERE id = ?', [JSON.stringify(payload), id]);
}

/** Valores sueltos que NO son caché (sobreviven al logout igual que la cola): mapas de ids locales→server. */
export async function getMeta(key: string): Promise<string | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}
export async function setMeta(key: string, value: string): Promise<void> {
  const db = await open();
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
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

/**
 * Rechazado por el server: no se reintenta solo. Se marca con `REJECTED_ATTEMPTS` intentos —supera el
 * techo de la cola sin agregar una columna a la base del teléfono— y sigue a la vista con su motivo.
 * «Reintentar ahora» igual lo vuelve a mandar (`force`). **El ítem NO se borra.**
 */
export const REJECTED_ATTEMPTS = 99;
export async function markRejected(id: number, error: string): Promise<void> {
  const db = await open();
  await db.runAsync('UPDATE queue SET attempts = ?, last_error = ? WHERE id = ?', [REJECTED_ATTEMPTS, error, id]);
}

/** Sólo para los tests y el borrado de datos del dispositivo. */
export async function resetForTests(): Promise<void> {
  const db = await open();
  await db.execAsync('DELETE FROM cache; DELETE FROM queue; DELETE FROM meta;');
  dbPromise = null;
}
