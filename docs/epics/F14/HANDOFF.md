# F14 · HANDOFF

## Sesión 2026-11-05
- **Dónde quedó:** F1 **CERRADA** (G4·G5·G6·G7 PASS). Rama `f14/p1-sesiones-aislamiento`, **commits locales, sin push/PR**. F2 **no se abrió**.
- **Hecho:** versiones de autorización `av`/`pv` con `AUTHZ_STALE` y reintento único (api/web/móvil), cierre de sesiones por membresía y a demanda (`POST /users/:id/sessions/revoke`, ADMIN y MANAGER acotado a su oficina y sin tocar admins/gerentes), Personas por oficina (R-02), clientes sin crédito por `created_by` (N-12), archivos mínimo (R-06). Migraciones `f14_01`, `f14_02` (MANAGER revoca), `f14_03` (sube `policy_version`). Las dos fallas ajenas se resolvieron (`route-lifecycle` era una prueba dependiente del día de la semana; `tsc` móvil).
- **Para la usuaria (leer):**
  1. **Despliegue:** `migrate deploy` + `pnpm --filter @kobrax/database db:rls` (aplica todos los RLS). Al desplegar, cada sesión recibe un `AUTHZ_STALE` único y renueva sola. La API sincroniza `policy_version` a Redis al arrancar.
  2. Detuve a pedido tuyo todos los procesos de Kobrax (nest watch, next dev, API). Para volver: levantarlos de nuevo; antes conviene `npx prisma generate` en `packages/database` (el motor ya no está bloqueado).
  3. Tras `prisma migrate reset` en dev hay que **vaciar Redis** (`FLUSHALL` de la base de dev): las versiones sólo suben y un `av` reseteado quedaría «obsoleto» para siempre.
  4. No correr `test:integration` en paralelo con otras suites que usen la misma DB/Redis (da fallas falsas).
- **Decisiones aprobadas:** H-1…H-13; D-1, D-2, D-5. **Pendientes:** ninguna de F1.
- **Verificaciones:** `execution/VERIFICATIONS.md` (V-001…V-014). Incidentes: `execution/INCIDENTS.md` (todos resueltos o nota).
- **Después del cierre:** la usuaria pidió «plan de F2»; como F2 depende de F3 (orden F1→F3→F2), eligió escribir primero **`plans/F3-authz-core.md`** (BORRADOR, rama `f14/p3-authz-core`).
- **F3 construida (2026-11-05, rama `f14/p3-authz-core`, commit `1937fa9`):** contrato de acceso por handler + `AuthzGuard` con negación por defecto; `JwtAuthGuard`/`TenantGuard`/`AuthzGuard` globales (registrados en `AuthModule`, orden verificado en integración); `@UseGuards` retirado de los 24 controladores; `RolesGuard` eliminado; `common/authz/` (`AuthorizationService`, `PolicyService`, `FactsLoader`, política `credit.writeOff`); 10 servicios migrados de `tenant.can`; puertas any-of de rutas/visitas (R-05); N-13 y N-09 hechos. Verificaciones V-015…V-019 en verde (API 1923, integración 201, web 1244, móvil 979).
- **Para la usuaria (leer):**
  1. **Snapshot de puertas** `docs/epics/F14/authz-snapshot.json` (203 handlers: 168 con permisos, 20 autenticados, 15 públicos): hay que **aprobarlo** para cerrar G5.
  2. Cambios visibles: `POST /routes`, `/routes/generate`, `/routes/plan-preview`, `/routes/leg`, `POST /visits` y `POST /visits/:id/evidence` ahora exigen en el guard «ejecutar, escribir o asignar ruta» (antes `route:read` + chequeo en el servicio). Un AUDITOR/VIEWER recibe `403 AUTH_002` en vez del código de ruta anterior.
  3. Rollback de un release: `AUTHZ_DENY_BY_DEFAULT=log`.
  4. Los `nest start --watch`/`next dev` siguen detenidos por tu orden anterior.
- **F3 cerrada (G5·G6·G7 PASS, V-020/V-021):** el code-review corrigió 7 puntos; el más relevante: `TenantGuard` vuelve a exigir tenant también a lo «sólo autenticado» (notificaciones, dispositivos, perfil, descargas). Snapshot aprobado.
- **Falta:** nada de F3. **F2** (permisos finos por fila: `credit.assign`, `client.create`, `member.invite`…, sobre `PolicyService`/`FactsLoader`) no se abrió.
- **Siguiente paso autorizado:** ninguno por iniciativa propia; esperar la orden de la usuaria (`plan de F2`). Sin push/PR.
