# F13 · Mapa de verificación

> «¿Con qué compruebo que esto sigue funcionando?». Los comandos salen de los `package.json` leídos el 2026-10-29 (VERIFICADO) y de las guías del repo.
> **Ninguno se ejecutó todavía para F13.** Los resultados van a `../execution/VERIFICATIONS.md`, no aquí.

## Comandos por paquete
| Paquete | Type-check | Tests | Fuente |
|---|---|---|---|
| `apps/api` | `pnpm --filter @kobrax/api type-check` (`tsc -p tsconfig.json --noEmit`) | `pnpm --filter @kobrax/api test` (`node --import tsx --test <lista fija de specs>`) · integración: `test:integration` (necesita DB) | `apps/api/package.json` |
| `apps/web` | `pnpm --filter @kobrax/web type-check` | `pnpm --filter @kobrax/web test` (`vitest run`) | `apps/web/package.json`, `apps/web/CLAUDE.md` |
| `apps/mobile` | `pnpm --filter @kobrax/mobile type-check` | `pnpm --filter @kobrax/mobile test` (`jest`); bundle: `npx expo export --platform android` (desde `apps/mobile`) | `apps/mobile/package.json`, `F10/BUILD-PLAN.md` §2 |
| `packages/shared` | `pnpm --filter @kobrax/shared type-check` | `pnpm --filter @kobrax/shared test` (`vitest run`) | `packages/shared/package.json` |
| `packages/database` | `pnpm --filter @kobrax/database type-check` | scripts SQL: `db:verify:seed`, `db:verify:contraccion` (`prisma db execute`) | `packages/database/package.json` |

## Trampas conocidas (VERIFICADO)
1. **El `test` de la API lista los specs uno por uno.** Un spec nuevo que no se agregue ahí no corre y nadie se entera. (RULES B12)
2. `prisma/verify/alcance-supervisor-agencia.sql` **no tiene script** en `package.json`: su cabecera pide correrlo con `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/alcance-supervisor-agencia.sql`. Solo `seed-sin-caso` y `sin-caso-contraccion` tienen script `db:verify:*`.
3. Los linters son placeholders (`lint: echo "(lint placeholder)"` en api, web, mobile, shared): **no verifican nada**.
4. Si se toca `packages/shared`: reconstruirlo y reiniciar el `dev` de la web (RULES B13).

## Qué cuenta como verificación de alcance/oficina
Hoy existen estos specs con nombres relacionados (existen en el `test` de la API; **que realmente prueben alcance por oficina es NO VERIFICADO**): `mora-scope-presets`, `mora-query`, `permission-gates`, `prisma-scope`, `import-agency`, `assignment.*`, `branches.service`, `users.service`, `agenda.service`, `analytics.service`.
En G1 se leen y se clasifica cada uno: protege / protege parcialmente / no protege.

## Verificaciones que F13 todavía no tiene (hay que diseñarlas en G2/G3)
- Prueba de aislamiento entre tenants con jerarquía.
- Regresión del perfil gratuito individual (RULES C4): lista de flujos por definir.
- Prueba de equivalencia del alcance actual vs. el nuevo (si se aprueba el candidato de RULES §E).
- Verificación SQL de migraciones de F13 (patrón `prisma/verify/*.sql`).
