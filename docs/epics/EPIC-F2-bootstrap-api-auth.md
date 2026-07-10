# EPIC F2 — DIVIDIDO en F2a + F2b

> ⚠️ **Este epic fue dividido.** Su contenido se reorganizó (sin pérdida) para evitar
> contradicciones y reducir el riesgo de alcance. **No editar este archivo** — usar los nuevos:

| Nuevo epic | Qué contiene |
|------------|--------------|
| [**EPIC-F2a**](./EPIC-F2a-nucleo-auth.md) | Núcleo: bootstrap API, login/refresh/logout, MFA (verify), multi-tenant, guards, RLS, login web+mobile mínimos. **Desbloquea F3.** |
| [**EPIC-F2b**](./EPIC-F2b-gestion-cuenta.md) | Gestión de cuenta: reset de contraseña, sesiones (UI), setup MFA + obligatoriedad, biometría, login offline, cambio forzado. |
| [**design-system.md**](../design-system.md) | Tokens, tipografía, componentes y animaciones (antes §11) — fuente única web+mobile. |

## Por qué se dividió y qué se corrigió
- **Riesgo de alcance:** F2 había crecido a ~1200 líneas (auth + reset + sesiones + MFA setup +
  biometría + offline + design system). F2a entrega lo mínimo para autenticar y desbloquear F3;
  F2b la experiencia de gestión.
- **Inconsistencias resueltas** (detalle en EPIC-F2a §3): `user_sessions` ya existía en F0 → **ALTER**
  (no CREATE); `CryptoService` se adelanta a F2a (lo exige `mfa_secret`); tabla `mfa_backup_codes`;
  **pre-auth token** + `select-account` con orden password→MFA→empresa (no filtra tenants);
  ventana de gracia en rotación de refresh; política de contraseña en `@kobrax/shared`; rate-limit
  en MFA/refresh; arquitectura web **BFF** (no next-auth); modelo de **sesión offline** (no el access de 15 min);
  gradiente como **array de colores** para React Native; tokens de diseño en **fuente única**;
  revocación instantánea por **denylist de sesión en Redis**.
