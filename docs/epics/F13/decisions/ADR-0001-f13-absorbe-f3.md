# ADR-0001 · F13 absorbe F3 (organización) y mantiene el número F13

- Estado: **APROBADA**
- Quién decide: la usuaria · Fecha: 2026-10-29
- Fuente de la aprobación: respuesta de la usuaria «si queda absorbido pero espera después» y su instrucción de construir el arnés de «EPIC-F13».

## Contexto
`docs/epics/README.md` lista F3 como «Identidad y Organización + administración RBAC», diferido a fin de proyecto (re-secuenciación 2026-06-18). F11 ya es «Analítica y reportes» y F12 «Hardening», por lo que el número libre siguiente es F13. (VERIFICADO: tabla del índice, leída 2026-10-29.)

## Problema
Dos épicas con el mismo territorio (organización/identidad) generarían planes y reglas duplicados.

## Alternativas consideradas
- A. Mantener F3 y crear F13 aparte → duplicación.
- B. Reutilizar el número F3 → rompe la numeración canónica que el índice dice conservar.
- C. **F13 absorbe lo de organización de F3** y el índice marca F3 como absorbido.

## Evidencia
Índice de épicas (`docs/epics/README.md`, filas F3/F11/F12) y nota de re-secuenciación (VERIFICADO).

## Decisión
C. F3 queda «absorbido por F13». La parte de F3 sobre **administración de roles/permisos** no se descarta: su ubicación se propone en ADR-0002 (F14).

## Consecuencias
- Se actualiza la fila F3 del índice y se agregan filas F13 y F14.
- No se renombran archivos de épicas existentes.
