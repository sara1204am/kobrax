import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE_PX } from '@kobrax/shared';
import { fitPhoto, resizeTarget, type PhotoOps } from './photo-compress';

/**
 * Pruebas de referencia del presupuesto de fotos (D-9). No hay mediciones de campo todavía: se modela el peso con una
 * función simple (los bytes escalan con los píxeles y con la calidad) y se verifica la LÓGICA de la escalera, que es lo
 * que no depende del teléfono. El peso real por escena se mide con `docs/epics/F10/plans/alineacion-web` §D-9.
 */

/** Un fake: el peso de salida = píxeles × factor(calidad). Los factores son supuestos, declarados. */
function fakeOps(basePixels: number, factorPorCalidad: Record<number, number>) {
  const llamadas: { target: object; quality: number }[] = [];
  const sizes = new Map<string, number>();
  const ops: PhotoOps = {
    render: async (_uri, target, quality) => {
      llamadas.push({ target, quality });
      const out = `out-${quality}`;
      sizes.set(out, Math.round(basePixels * (factorPorCalidad[quality] ?? 1)));
      return { uri: out };
    },
    sizeOf: async (uri) => sizes.get(uri) ?? null,
  };
  return { ops, llamadas };
}

describe('resizeTarget · solo el lado largo, solo si hace falta', () => {
  it('apaisada: limita el ancho; vertical: limita el alto', () => {
    expect(resizeTarget(4000, 3000)).toEqual({ width: PHOTO_MAX_EDGE_PX });
    expect(resizeTarget(3000, 4000)).toEqual({ height: PHOTO_MAX_EDGE_PX });
  });

  it('una foto que ya entra no se agranda ni se toca', () => {
    expect(resizeTarget(1024, 768)).toEqual({});
    expect(resizeTarget(1280, 960)).toEqual({});
  });

  it('sin dimensiones conocidas no se redimensiona a ciegas', () => {
    expect(resizeTarget(undefined, undefined)).toEqual({});
    expect(resizeTarget(4000, undefined)).toEqual({});
  });
});

describe('fitPhoto · la escalera de calidad', () => {
  it('🔴 con la primera calidad entra: una sola pasada y sin tocar nada más', async () => {
    const { ops, llamadas } = fakeOps(1_000_000, { 0.7: 0.2 }); // 200 KB
    const out = await fitPhoto('orig', { width: 4000, height: 3000 }, ops);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toEqual({ target: { width: 1280 }, quality: 0.7 });
    expect(out).toMatchObject({ quality: 0.7, overBudget: false });
  });

  it('si se pasa de 800 KB baja un escalón por vez hasta entrar', async () => {
    const { ops, llamadas } = fakeOps(1_000_000, { 0.7: 1.2, 0.55: 0.9, 0.4: 0.5 });
    const out = await fitPhoto('orig', { width: 4000, height: 3000 }, ops);
    expect(llamadas.map((l) => l.quality)).toEqual([0.7, 0.55, 0.4]);
    expect(out.quality).toBe(0.4);
    expect(out.bytes).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
    expect(out.overBudget).toBe(false);
  });

  it('cada intento parte de la ORIGINAL, no de la ya comprimida', async () => {
    const usadas: string[] = [];
    const ops: PhotoOps = {
      render: async (uri, _t, q) => {
        usadas.push(uri);
        return { uri: `out-${q}` };
      },
      sizeOf: async () => PHOTO_MAX_BYTES * 2,
    };
    await fitPhoto('original.jpg', { width: 4000, height: 3000 }, ops);
    expect(new Set(usadas)).toEqual(new Set(['original.jpg']));
  });

  it('🔴 si ni con el último escalón entra, devuelve lo mejor que hay y lo marca (no lanza, no bloquea)', async () => {
    const { ops } = fakeOps(1_000_000, { 0.7: 3, 0.55: 2.6, 0.4: 2.2 });
    const out = await fitPhoto('orig', { width: 4000, height: 3000 }, ops);
    expect(out.overBudget).toBe(true);
    expect(out.quality).toBe(0.4);
  });

  it('sin poder medir el peso se acepta la primera pasada', async () => {
    const ops: PhotoOps = { render: async () => ({ uri: 'x' }), sizeOf: async () => null };
    const out = await fitPhoto('orig', {}, ops);
    expect(out).toMatchObject({ uri: 'x', bytes: null, overBudget: false });
  });

  it('referencia: una foto de 12 MP (4000×3000) a ~0.18 bytes/px queda en ~215 KB tras limitarla a 1280 px', async () => {
    // 1280×960 ≈ 1.23 MP; a 0.7 de calidad, ~1.4 bits/px → ~215 KB: el orden de magnitud que justifica el tope.
    const px = 1280 * 960;
    const { ops } = fakeOps(px, { 0.7: 0.175 });
    const out = await fitPhoto('orig', { width: 4000, height: 3000 }, ops);
    expect(out.bytes! / 1024).toBeGreaterThan(150);
    expect(out.bytes! / 1024).toBeLessThan(350);
  });
});
