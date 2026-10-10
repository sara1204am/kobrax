/**
 * Presupuesto de almacenamiento offline del móvil (D-9): fotos, caché de imágenes, mapas y base local.
 *
 * Vive en `shared` para que el servidor, el móvil y la documentación hablen de los mismos números. **Cada valor tiene su
 * derivación acá al lado**: un límite sin evidencia es un número arbitrario, y uno que nadie puede revisar se vuelve dogma.
 *
 * SUPUESTOS (no medidos en campo todavía — ver `docs/epics/F10/plans/alineacion-web/README.md §D-9`):
 *  · una jornada típica son 8–16 paradas (rutas demo y blueprint F4/12); el techo de cálculo es **30**;
 *  · una foto de teléfono medio sale de 12 MP; sin redimensionar, a calidad 0.5, pesa ~0.8–2.5 MB (varía con la escena);
 *  · la zona de trabajo de un cobrador es una ciudad: radio de 10 km alcanza para una jornada a pie/moto;
 *  · un teléfono de gama baja tiene 16–32 GB con 2–6 GB libres: **el presupuesto total de la app tiene que ser << 1 GB**.
 */

const MB = 1024 * 1024;

// ── Fotos de evidencia ────────────────────────────────────────────────────────────────────────────

/**
 * Lado largo máximo de una foto que se sube. 1280 px (≈ 1 MP): sobra para reconocer una fachada o leer un comprobante, y
 * baja una foto de 12 MP de ~2 MB a ~150–350 KB. Más resolución no agrega evidencia, agrega datos móviles.
 */
export const PHOTO_MAX_EDGE_PX = 1280;

/**
 * Techo de una foto individual: 800 KB, la regla que el CLAUDE.md del móvil ya fijaba («comprime a max 800 KB») y que
 * ninguna parte cumplía. El servidor acepta hasta 8 MB (`MAX_UPLOAD_BYTES`): éste es el objetivo del cliente, no su límite.
 */
export const PHOTO_MAX_BYTES = 800 * 1024;

/** Calidad JPEG, de mejor a peor: se baja un escalón por vez hasta entrar en `PHOTO_MAX_BYTES`. */
export const PHOTO_QUALITY_LADDER = [0.7, 0.55, 0.4] as const;

/**
 * Fotos pendientes de subir que el teléfono guarda como máximo (en bytes): 150 MB.
 *
 * Derivación: peor caso de una jornada = 30 paradas × 1 evidencia + 5 extras = 35 fotos × 800 KB ≈ 28 MB. Con 150 MB caben
 * ~5 jornadas **sin una sola sincronización** (una semana sin señal es ya un problema operativo, no de almacenamiento). Al
 * llegar al tope NO se borra nada pendiente: se bloquean las fotos NUEVAS con un mensaje claro, para que el cobrador sepa
 * que tiene que sincronizar.
 */
export const PENDING_PHOTOS_MAX_BYTES = 150 * MB;
/** Aviso previo: al 80 % del tope se avisa «hay que sincronizar». */
export const PENDING_PHOTOS_WARN_RATIO = 0.8;

// ── Fotos de la casa en caché (miniaturas y visor de las paradas) ─────────────────────────────────

/**
 * Caché de imágenes de ubicaciones: 40 MB, LRU.
 *
 * Derivación: solo la foto **principal** de lo que hay hoy en ruta (30 paradas × ~250 KB ≈ 7.5 MB) más las de las rutas
 * próximas (hasta 14 días, ~3 rutas armadas de 16 → 12 MB) y un margen para el visor (las otras fotos de la parada actual).
 * 40 MB deja ~2.5× de holgura sin ser un peso para un teléfono de 16 GB. Es **descartable**: se vuelve a bajar.
 */
export const IMAGE_CACHE_MAX_BYTES = 40 * MB;
/** Cuántas fotos de una misma parada se precargan: la principal. El resto se baja al abrir el visor, con señal. */
export const IMAGE_CACHE_PRELOAD_PER_LOCATION = 1;

// ── Mapas offline ─────────────────────────────────────────────────────────────────────────────────

/** Radio de una región descargable alrededor de la zona de trabajo: 10 km (una ciudad mediana, una jornada). */
export const MAP_PACK_RADIUS_KM = 10;
/** Zoom mínimo/máximo de un pack: 10 (ciudad) a 15 (calle con números). El 16 cuadruplica los tiles y no suma para ubicar. */
export const MAP_PACK_MIN_ZOOM = 10;
export const MAP_PACK_MAX_ZOOM = 15;
/** Tiles máximos por pack (corte duro previo a descargar). El de referencia (10 km, z10–15) da ~530 tiles ≈ 13 MB. */
export const MAP_PACK_MAX_TILES = 1_500;
/** Regiones descargadas a la vez (se descarta la más vieja). */
export const MAP_PACK_MAX_REGIONS = 3;
/**
 * Peso medio estimado de un tile de un estilo vectorial self-hosted: ~25 KB (referencia de tiles OpenMapTiles en zoom
 * urbano; los raster PNG de OSM rondan 20–40 KB). Es un SUPUESTO para estimar antes de descargar; el diagnóstico mide el real.
 */
export const MAP_TILE_AVG_BYTES = 25 * 1024;
/** Total para todos los packs: 150 MB (3 regiones × ~1500 tiles × 25 KB = ~110 MB en el peor caso). */
export const MAP_PACKS_MAX_BYTES = 150 * MB;

// ── Base local (SQLite) ───────────────────────────────────────────────────────────────────────────

/**
 * Cuánto vive una fila del caché sin renovarse. Una ficha de cliente trae teléfonos y direcciones (PII): retenerla de más
 * es riesgo sin beneficio. 7 días cubre una semana sin señal con la hidratación de oficina.
 */
export const CACHE_TTL_DAYS = 7;
/** Tope del archivo de caché; al pasarlo se purga lo más viejo (nunca la cola). */
export const CACHE_MAX_BYTES = 50 * MB;

// ── Funciones puras (se prueban sin dispositivo) ──────────────────────────────────────────────────

/**
 * Cuántos tiles tiene una región cuadrada de `radiusKm` alrededor de un punto, de `minZoom` a `maxZoom`, a la latitud dada.
 * Aproximación estándar: ancho de un tile = circunferencia · cos(lat) / 2^z. Sirve para decidir **antes** de descargar.
 */
export function estimatePackTiles(radiusKm: number, latitude: number, minZoom: number, maxZoom: number): number {
  const EARTH_CIRCUMFERENCE_KM = 40_075;
  const side = radiusKm * 2;
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const tileKm = (EARTH_CIRCUMFERENCE_KM * Math.cos((latitude * Math.PI) / 180)) / 2 ** z;
    // +1: una región casi nunca coincide con la grilla; cruza al menos un tile más por lado.
    const perSide = Math.ceil(side / tileKm) + 1;
    total += perSide * perSide;
  }
  return total;
}

/** Peso estimado de un pack en bytes. */
export function estimatePackBytes(tiles: number): number {
  return tiles * MAP_TILE_AVG_BYTES;
}

export type PackDecision = { ok: true; tiles: number; bytes: number } | { ok: false; reason: 'too-many-tiles' | 'over-storage'; tiles: number; bytes: number };

/**
 * ¿Se puede descargar este pack? `usedBytes` = lo que ya ocupan los otros packs. Se decide ANTES de empezar: una descarga a
 * medias que se queda sin lugar es peor que una que nunca arrancó.
 */
export function decidePack(args: { radiusKm: number; latitude: number; minZoom: number; maxZoom: number; usedBytes: number }): PackDecision {
  const tiles = estimatePackTiles(args.radiusKm, args.latitude, args.minZoom, args.maxZoom);
  const bytes = estimatePackBytes(tiles);
  if (tiles > MAP_PACK_MAX_TILES) return { ok: false, reason: 'too-many-tiles', tiles, bytes };
  if (args.usedBytes + bytes > MAP_PACKS_MAX_BYTES) return { ok: false, reason: 'over-storage', tiles, bytes };
  return { ok: true, tiles, bytes };
}

/**
 * Siguiente calidad JPEG para bajar el peso de una foto, o `null` si ya no hay escalón (se queda con la última).
 * `current` = la calidad con la que se acaba de comprimir.
 */
export function nextPhotoQuality(current: number): number | null {
  const i = PHOTO_QUALITY_LADDER.indexOf(current as (typeof PHOTO_QUALITY_LADDER)[number]);
  if (i < 0) return PHOTO_QUALITY_LADDER[0];
  return PHOTO_QUALITY_LADDER[i + 1] ?? null;
}

export type PhotoSlot = { allowed: true; warn: boolean } | { allowed: false; reason: 'pending-full' };

/**
 * ¿Entra una foto nueva en el presupuesto de pendientes? Al tope se bloquea la NUEVA; lo ya guardado jamás se toca.
 */
export function canQueuePhoto(args: { pendingBytes: number; newBytes: number }): PhotoSlot {
  if (args.pendingBytes + args.newBytes > PENDING_PHOTOS_MAX_BYTES) return { allowed: false, reason: 'pending-full' };
  return { allowed: true, warn: args.pendingBytes + args.newBytes >= PENDING_PHOTOS_MAX_BYTES * PENDING_PHOTOS_WARN_RATIO };
}
