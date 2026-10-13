/**
 * Reducir una foto al presupuesto (D-9): lado largo ≤ 1280 px y ≤ ~800 KB, bajando la calidad por escalones.
 *
 * **La lógica es pura y las operaciones nativas se inyectan**: así se prueba sin teléfono (ver `photo-compress.test.ts`).
 * Siempre se parte de la foto ORIGINAL en cada intento (nunca se recomprime una ya comprimida: cada pasada degrada).
 *
 * Nunca bloquea al cobrador: si la compresión falla por cualquier motivo, la foto original sigue su camino (el servidor
 * acepta hasta 8 MB). Peor que una foto pesada es una visita sin foto.
 */
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE_PX, PHOTO_QUALITY_LADDER, nextPhotoQuality } from '@kobrax/shared';

export interface PhotoOps {
  /** Redimensiona (si `target` trae lado) y comprime a JPEG con esa calidad. Devuelve la ruta del archivo nuevo. */
  render(uri: string, target: { width?: number; height?: number }, quality: number): Promise<{ uri: string }>;
  /** Peso en bytes, o `null` si no se puede saber. */
  sizeOf(uri: string): Promise<number | null>;
}

export interface FittedPhoto {
  uri: string;
  bytes: number | null;
  /** Calidad con la que quedó. */
  quality: number;
  /** `true` si se tuvo que quedar con el último escalón y aun así pesa más que el objetivo. */
  overBudget: boolean;
}

/**
 * Lado a limitar: solo el largo, y solo si supera el máximo. Sin dimensiones conocidas no se redimensiona (la calidad sola
 * ya baja el peso) — mandar un `resize` a ciegas podría agrandar una foto chica.
 */
export function resizeTarget(width?: number, height?: number, maxEdge: number = PHOTO_MAX_EDGE_PX): { width?: number; height?: number } {
  if (!width || !height) return {};
  if (Math.max(width, height) <= maxEdge) return {};
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

/** Comprime hasta entrar en `PHOTO_MAX_BYTES`. Devuelve el mejor resultado alcanzable, nunca lanza por falta de escalones. */
export async function fitPhoto(
  uri: string,
  dims: { width?: number; height?: number },
  ops: PhotoOps,
  maxBytes: number = PHOTO_MAX_BYTES,
): Promise<FittedPhoto> {
  const target = resizeTarget(dims.width, dims.height);
  let quality: number = PHOTO_QUALITY_LADDER[0];

  for (;;) {
    const out = await ops.render(uri, target, quality);
    const bytes = await ops.sizeOf(out.uri);
    // Sin poder medir se acepta: la calidad inicial ya es razonable y no hay con qué decidir otra cosa.
    if (bytes === null || bytes <= maxBytes) return { uri: out.uri, bytes, quality, overBudget: false };

    const next = nextPhotoQuality(quality);
    if (next === null) return { uri: out.uri, bytes, quality, overBudget: true };
    quality = next;
  }
}
