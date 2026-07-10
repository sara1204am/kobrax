# F4 · Fase 4 — Tests, hardening y cierre

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** ⏳ Pendiente
**Owner:** Testing · Security · **Depende de:** Fases 0–3 (puede correr en **paralelo** desde la Fase 2)

> Cierra F4 con la pirámide de pruebas, la verificación de privacidad (PII nunca en claro) y el aislamiento
> multi-tenant real. Es el guardián del DoD del epic.

## Objetivo
Garantizar, con evidencia automatizada, que F4 cumple su DoD funcional, de seguridad/privacidad y de calidad.

## Matriz de pruebas
| Tipo | Casos requeridos | Cobertura |
|------|------------------|-----------|
| **Unit** | Cifrado/descifrado roundtrip · tokenización (máscaras, casos borde) · blind index determinista (normalización) · generador de cronograma (1 cuota, interés 0, redondeo) · recálculo de mora (gracia, parcial, al día, idempotencia) | ≥ 80% |
| **Integración** | `POST /clients` → PII **cifrada en DB** · duplicado → `409` · `GET` tokenizado · `PATCH` re-cifra · **RLS A/B** (tenant A no ve B → `404`) · `audit_log` por mutación · `?reveal`+permiso → plaintext+audit · invariante de cronograma · recálculo de mora reproducible | Críticos al 100% |
| **Negativos** | PII en logs (assert **ausente**) · PII en claro sin `?reveal` (assert **ausente**) · duplicado → `409` (no 500) · cronograma inválido → `400 SCHEDULE_INVALID` · cross-tenant → `404` genérico (no 403, no revela existencia) · `?reveal` sin permiso → `403` | 100% |

## Análisis / decisiones a tomar
1. **Harness de integración (🔴 decidir antes de empezar).** El backend hoy usa **`node:test` + tsx** (47 tests; sin Jest).
   El master de F4 menciona **Jest + supertest + testcontainers**. Decisión:
   **(a)** mantener `node:test` + tsx y añadir **testcontainers** (Postgres real) para los tests de RLS/integración, o
   **(b)** introducir Jest+supertest solo para integración. **Recomendado: (a)** — consistencia con el harness existente;
   añadir un helper de testcontainers reutilizable (también sirve para el `rls.spec` que quedó pendiente de F1/Slice 7).
2. **Datos de prueba.** Reusar el `seed` (ya cifrado tras Fase 0) o construir fixtures por test. Recomendado: fixtures
   por test sobre una DB efímera (testcontainers) para no depender del orden del seed.
3. **Assert de "PII nunca en claro".** Definir el método: interceptar logs + inspeccionar el body de respuesta y la fila en DB.
   Centralizar un helper `assertNoPlaintextPII(value)` que falle si el documento/teléfono aparecen sin máscara.

## Checklist de seguridad F4 (DoD de seguridad — copia del master §5.3, se verifica aquí)
- [ ] Toda query con contexto RLS del tenant (`TenantContextInterceptor`, `kobrax_app`, nunca superuser).
- [ ] `JwtAuthGuard`+`TenantGuard`+`RolesGuard` en **todos** los endpoints.
- [ ] DTOs `whitelist`+`forbidNonWhitelisted`; `ParseUUIDPipe`.
- [ ] PII cifrada en reposo + tokenizada; `?reveal` con permiso + audit.
- [ ] Documento buscable/único vía blind index; clave índice ≠ clave cifrado.
- [ ] PII **nunca** en logs ni en errores; errores genéricos sin enumeración.
- [ ] Toda mutación → `audit_log` append-only con `before/after` redactado.
- [ ] `file_hash` sellado; adjunto inmutable (PATCH → 405).
- [ ] Invariante de cronograma; montos no negativos; `currency` del tenant.
- [ ] Recálculo de mora idempotente y determinista.
- [ ] Aislamiento cross-tenant (A/B) verificado.
- [ ] PII en claro sin `?reveal` ausente (assert).

## Criterios de aceptación (DoD Fase 4 = cierre de F4)
- [ ] Toda la matriz de pruebas en verde; cobertura de `clients`/`credits` ≥ 80%.
- [ ] `lint` + `type-check` + `test` verdes en CI; sin secrets hardcodeados (`ConfigModule` valida al boot).
- [ ] Endpoints documentados en OpenAPI/Swagger con ejemplos de **respuesta tokenizada**.
- [ ] Checklist de seguridad F4 al 100%.

## Verificación
```powershell
pnpm --filter @kobrax/api test         # unit + integración (testcontainers) + negativos
pnpm --filter @kobrax/api type-check
# Cobertura ≥ 80% en clients/credits; reporte adjunto al cierre del epic
```
