# Importación de cartera por API — plan de implementación

> **ESTADO: PENDIENTE — sin código.** Anotado el 2026-11-26 para retomar. Las preguntas abiertas se responden antes de la etapa 2.

## Decisión base

La API **se trata igual que un archivo**: Kobrax llama a la API del banco, recibe un JSON, lo convierte en filas y de ahí en adelante
sigue el mismo camino (emparejar columnas → vista previa → importar → historial). El banco no adapta sus nombres de campo: se emparejan
en Ajustes.

```
Archivo (PDF, Excel, CSV) ─┐
                           ├─► filas ─► readRows ─► emparejar ─► vista previa ─► importar ─► historial
API → JSON ────────────────┘
```

## Qué ya existe y se reutiliza

- `apps/api/src/modules/imports/parsers/rows.parser.ts` → `readRows(filas, emparejado)`: etiquetas, muestras y candidatas de mora.
- `pdf-rows.parser.ts` → `splitCodeAndName`: separa «número + nombre» en columnas derivadas (aplicable también al JSON).
- Reglas de alcance, créditos ausentes, fecha de corte (`reportDate` ya se acepta en el cuerpo), vista previa en seco e historial.

## Lo que no existe (verificado el 2026-11-25/26)

- `import-config.ts` sólo admite `source: 'manual' | 'file'`.
- `CreditDataOrigin.API` está en el enum de Prisma, pero nada lo escribe.
- No hay claves de API, webhook ni endpoint de ingesta (`docs/epics/F13/discovery/06-sync-importacion.md`).

## Etapa 1 — JSON subido como archivo

Se prueba sin depender del banco.

| # | Cambio |
|---|---|
| 1.1 | `profile.kind = 'json'` con `recordsPath` (dónde está la lista, p. ej. `data.creditos`) |
| 1.2 | `parsers/json-rows.parser.ts`: detectar las listas candidatas, aplanar anidados (`cliente.nombre`), todo a texto, y llamar a `readRows` |
| 1.3 | Reglas para listas dentro de un registro (teléfonos, garantes): unir en una celda; decidir con un ejemplo real |
| 1.4 | Números y fechas ISO: revisar `normalizeRecord` (hoy espera formatos de reporte, p. ej. `1.234,56` y `dd/mm/aaaa`) |
| 1.5 | Topes: 15 MB como los demás, cantidad máxima de registros y profundidad |
| 1.6 | Web: cuarta forma de archivo en Ajustes y selector de la lista de registros; aceptar `.json` |
| 1.7 | Pruebas del lector y una de extremo a extremo (vista previa en seco) |

## Etapa 2 — Conexión a la API

| # | Cambio |
|---|---|
| 2.1 | «De dónde sale la cartera»: archivo · **API** · manual |
| 2.2 | Datos de conexión: URL, tipo de autenticación, clave; botón «Probar conexión» |
| 2.3 | Clave **cifrada** en la base, nunca devuelta a la web ni escrita en registros ni auditoría |
| 2.4 | Contra SSRF: sólo `https`, bloquear IP privadas/locales **después de resolver el DNS**, sin seguir redirecciones, con tope de tiempo y de tamaño |
| 2.5 | Paginación: traer **todas** las páginas; si una falla, **no se importa nada** (si no, créditos existentes quedarían como ausentes) |
| 2.6 | Botón «Traer datos»: guarda el JSON recibido como el archivo de la corrida (historial y descarga) y abre la vista previa |
| 2.7 | La vista previa y la confirmación usan **el mismo JSON guardado**, no una segunda llamada |
| 2.8 | Permisos, auditoría y RLS como en el resto del import; declarar el contrato de cada endpoint |

## Etapa 3 — Automática (después)

Ejecución diaria. Hay que decidir si aplica sola o deja el envío pendiente de revisión, y qué hacer con los créditos nuevos sin
responsable (hoy bloquean la confirmación).

## Preguntas abiertas

1. ¿Hay un ejemplo del JSON (con datos inventados)?
2. ¿Cómo se autentica la API (clave en cabecera, usuario y contraseña, OAuth)?
3. ¿Pagina? ¿Cómo?
4. ¿Se pide la cartera completa o sólo los cambios? La regla de ausentes **exige la completa**.
5. ¿La fecha de corte viene en el JSON?
