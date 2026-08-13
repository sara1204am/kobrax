import { describe, expect, it } from 'vitest';
import { WIDGET_TYPES } from '@kobrax/shared';
import { DEFAULT_WIDGETS, WIDGET_DEFINITIONS, widgetDefinition } from './widget-registry';

describe('catálogo de widgets', () => {
  it('🔴 los doce tipos del contrato están en el catálogo', () => {
    // Un tipo que exista en `shared` y no acá se puede guardar en la base y después **no se puede
    // dibujar**: el tablero abre con un hueco y nadie sabe qué había ahí.
    expect(WIDGET_DEFINITIONS.map((d) => d.type).sort()).toEqual([...WIDGET_TYPES].sort());
  });

  it('un tipo desconocido no revienta: devuelve undefined', () => {
    expect(widgetDefinition('astrolabio')).toBeUndefined();
  });

  it('ningún widget nace más chico que su mínimo', () => {
    // Con `defaultSize` por debajo de `minSize`, la grilla lo estira al soltarlo y el widget salta
    // solo apenas entra.
    for (const d of WIDGET_DEFINITIONS) {
      expect(d.defaultSize.w).toBeGreaterThanOrEqual(d.minSize.w);
      expect(d.defaultSize.h).toBeGreaterThanOrEqual(d.minSize.h);
    }
  });

  it('ningún widget es más ancho que la grilla', () => {
    for (const d of WIDGET_DEFINITIONS) expect(d.defaultSize.w).toBeLessThanOrEqual(12);
  });
});

describe('tablero por defecto', () => {
  it('todos sus widgets son de un tipo del catálogo y con fuente de datos', () => {
    for (const w of DEFAULT_WIDGETS) {
      const def = widgetDefinition(w.type);
      expect(def, `${w.type} no está en el catálogo`).toBeDefined();
      expect(def!.source, `${w.type} entra al tablero por defecto sin dato detrás`).not.toBeNull();
    }
  });

  it('🔴 ningún widget se sale de las 12 columnas', () => {
    // `x + w > 12` deja el widget cortado contra el borde y sin forma de agarrarlo para moverlo.
    for (const w of DEFAULT_WIDGETS) expect(w.layout.x + w.layout.w).toBeLessThanOrEqual(12);
  });

  it('ningún par de widgets se pisa', () => {
    // La grilla los reacomoda sola si se pisan, así que el defecto no se ve al abrir: se ve como
    // «los widgets aparecen en otro orden del que dice el código».
    for (const a of DEFAULT_WIDGETS) {
      for (const b of DEFAULT_WIDGETS) {
        if (a.id === b.id) continue;
        const overlap =
          a.layout.x < b.layout.x + b.layout.w &&
          b.layout.x < a.layout.x + a.layout.w &&
          a.layout.y < b.layout.y + b.layout.h &&
          b.layout.y < a.layout.y + a.layout.h;
        expect(overlap, `${a.id} se pisa con ${b.id}`).toBe(false);
      }
    }
  });

  it('los ids no se repiten', () => {
    expect(new Set(DEFAULT_WIDGETS.map((w) => w.id)).size).toBe(DEFAULT_WIDGETS.length);
  });
});
