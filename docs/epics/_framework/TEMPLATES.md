# Plantillas del marco de épicas

> Se copian y se llenan. Ninguna se rellena con suposiciones: lo que no se sabe va como DESCONOCIDO.

## T1 · Hallazgo de discovery

```
### H-<área>-<nn> · <título corto>
- Clase: VERIFICADO | INFERIDO | NO VERIFICADO | DESCONOCIDO | CONTRADICTORIO
- Evidencia: <archivo:línea · símbolo · test · comando+resultado>   (fecha)
- Hecho: <una frase, sin interpretación>
- Implica para la épica: <una frase o «—»>
- HUB: <HUB-nnn o «—»>
```

## T2 · ADR (decisión arquitectónica)

```
# ADR-<nnnn> · <título>
- Estado: PROPUESTA | APROBADA | RECHAZADA | SUSTITUIDA por ADR-nnnn
- Quién decide: <usuaria | técnico> · Fecha de aprobación: <o «—»>
- Fuente de la aprobación: <cita o mensaje; vacío si no está aprobada>
## Contexto
## Problema
## Alternativas consideradas   (A, B, C… cada una con pro/contra)
## Evidencia                   (hallazgos H-… o archivo:línea; clase de cada uno)
## Decisión                    (vacío mientras sea PROPUESTA)
## Consecuencias
```

Una PROPUESTA nunca autoriza código.

## T3 · Entrada del HUB

| ID | Módulo | Archivo y símbolo | Responsabilidad | Consumidores | Dependencias | Riesgo de modificación | Fase prevista | Cambio realizado | Prueba que lo protege | Estado de verificación |
|---|---|---|---|---|---|---|---|---|---|---|

Estados: `SEMBRADO` (visto, sin releer) · `VERIFICADO <fecha>` · `MODIFICADO <fase>` · `REVERIFICADO <fecha>`.

## T4 · Plan de fase (se crea al empezar la fase, en `plans/`)

```
> ESTADO: BORRADOR | VALIDADO (PASS <fecha>) | EN EJECUCIÓN | CERRADO
# Plan <Fase> · <nombre>
1. Objetivo (1–2 frases)
2. Rama: f13/<fase>-<nombre>
3. Estado inicial con evidencia (hallazgos H-… releídos HOY contra el código)
4. Alcance / fuera de alcance
5. Dependencias (fases, ADR aprobados, gates)
6. Archivos afectados (con IDs HUB; ninguno sin consultar)
7. Invariantes que aplican (IDs de RULES.md)
8. Perfiles de tenant afectados y cómo se protege el individual/gratuito
9. Riesgos
10. Pruebas (cuáles existen, cuáles se agregan, cómo se registran en el script `test` de la API)
11. Rollback (cómo se deshace; qué migración es reversible y cuál no)
12. Tareas ordenadas (datos → API → web → móvil)
13. Criterios de cierre (G5–G7, con evidencia exigida)
```

## T5 · Registro de verificación (`execution/VERIFICATIONS.md`)

| Fecha | Fase | Qué se verificó | Comando | Resultado (pegar salida o ruta al log) | PASS/FAIL | Quién |
|---|---|---|---|---|---|---|

Sin salida pegada, la fila no cuenta.

## T6 · Bloque de handoff (al final de cada sesión)

```
## Sesión <fecha>
- Dónde quedó: <fase, paso exacto>
- Terminado: ...        - Falta: ...
- Decisiones aprobadas (ADR): ...        - Pendientes: ...
- Archivos cambiados: ...
- Verificaciones: PASS <...> / FAIL <...> / no corridas <...>
- Siguiente paso autorizado: <uno solo, o «ninguno: esperar autorización»>
```
