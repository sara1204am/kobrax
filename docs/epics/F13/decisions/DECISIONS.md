# F13 · Registro de decisiones (ADR)

> Plantilla: `../../_framework/TEMPLATES.md` T2. **Una PROPUESTA no es una decisión y no autoriza código.** Solo la usuaria aprueba.
> Si una decisión se sustituye, el ADR viejo se marca SUSTITUIDA y se enlaza al nuevo; no se borra.

| ADR | Título | Estado | Bloquea | Fuente de aprobación |
|---|---|---|---|---|
| [0001](./ADR-0001-f13-absorbe-f3.md) | F13 absorbe F3 (organización) y mantiene el número | **APROBADA** | — | Mensaje de la usuaria, 2026-10-29: «si queda absorbido» |
| [0002](./ADR-0002-frontera-f13-f14.md) | Frontera entre F13 (organización) y F14 (roles) | PROPUESTA (con decisión recomendada) | G2 | — |
| [0003](./ADR-0003-representacion-del-arbol.md) | Cómo se representa el árbol de oficinas | **APROBADA** (extender `branches`) | — | «confirmo G1 y las 4 decisiones», 2026-11-02 |
| [0004](./ADR-0004-tenant-sin-jerarquia.md) | Tenant gratuito/individual frente al árbol | **APROBADA** (raíz = razón social, cuenta en el tope, cartera se mueve al ramificar) | — | respuestas a revisión Fable, 2026-11-02 |

Aprobadas también el 2026-11-02 («confirmo G1 y las 4 decisiones»): **D-1** árbol = extender `branches` · **D-2** rol por asignación (R8) · **D-3** backfill de créditos por capas con excepciones, validación A-1 al final · **D-8** los 7 fallos web y el type-check móvil son preexistentes y quedan fuera de F13.

## Respuestas de la usuaria (2026-11-02) — requisitos, aún sin ADR formal
Son requisitos dichos por la usuaria; Discovery los contrasta con el código y G2 los convierte en ADR.

| # | Tema | Respuesta literal (resumen) | Implicación a validar |
|---|---|---|---|
| R1 | Niveles | Debe ser **flexible al crear oficinas** (no un máximo fijo Nacional/Regional/Agencia). | Profundidad y nombres de nivel configurables; afecta ADR-0003. |
| R2 | Interfaz | La vista de oficinas toma como **referencia la sección de oficinas de Gallium**, en `C:\Tutator\gallium-10` (fuera del repo; solo lectura). | Leer esa sección antes de `target/04-experiencia-web.md`. |
| R3 | Pertenencia | Un usuario **puede estar en más de una oficina**. | Relación N:M usuario↔oficina; afecta alcance, sesión/contexto (P3) y JWT. |
| R4 | Alcance cruzado | Un **normalizador de cartera pertenece a una regional** y puede tener **clientes de cobranza urgente de distintas agencias**. | Asignación en un nodo cubre su subárbol; la cartera se filtra por alcance, no por agencia única. |
| R5 | Quién crea oficinas | **SUSTITUIDA por R12 (2026-11-02).** Antes: **solo el super admin** puede crear oficinas, **a cualquier nivel**. Reemplaza el reparto anterior (nacional crea regionales, etc.). | Permiso exclusivo de super admin; ningún otro rol crea nodos. Ver cómo convive con el tenant gratuito (ADR-0004). |
| R6 | Alcance de la épica | F13 es la **base para los roles y los permisos de cada rol** (F14). | Redefine la frontera F13/F14 (ADR-0002): F13 debe dejar el modelo de alcance, el permiso de gestión de oficinas y los puntos de enganche listos para que F14 asigne permisos por rol. |

| R7 | Vista de oficinas | **Igual que en Gallium** (`C:\Tutator\gallium-10`), no solo «como referencia». | `target/04-experiencia-web.md` replica su estructura y comportamiento; adaptar solo lo que el modelo de Kobrax exija. |
| R8 | Rol: por asignación o global | Recomendación de la IA: **rol por asignación** (usuario + oficina + rol). Pendiente de aprobación de la usuaria. | Con R3 y R4 un rol global daría el mismo poder en todas las oficinas. Tenant gratuito: una asignación implícita. Base para F14. |
| R9 | Orden de trabajo | Primero la base (modelo de oficinas, usuarios, roles). **JWT y seguridad después**, una vez hecha la base. | JWT, sesión móvil y RLS por alcance quedan fuera de P1–P2 y se tratan en su propia fase; los desconocidos de STATUS se mantienen hasta entonces. |

| R10 | Caso de referencia (2026-11-02) | Esquema a crear: **Central** → regionales **La Paz**, **Cochabamba**, **Chuquisaca**. Chuquisaca «tiene 6 agencias»: en Sucre **Mesa Verde**, **Central**, **Luz y Verdad**; en provincia **Padilla** y **Monteagudo**. | Sirve de caso de prueba del modelo y de la semilla de demostración. Sexta agencia confirmada: **Camargo** (provincia). La usuaria confirmó el árbol («sí, exacto»). Supuesto: «Sucre / provincia» es una descripción, no un nivel (la usuaria no lo contradijo; reabrir si lo es). La Paz y Cochabamba aún sin agencias. **UI:** mostrar siempre la ruta completa (p. ej. Central › Chuquisaca › Central) para no confundir nombres repetidos. |

| R11 | Super admin | **Decisión para G2 (2026-11-02, usuaria):** `SUPER_ADMIN` es un rol de **PLATAFORMA** (equipo de Kobrax), no un rol de organización ni el dueño de una cuenta. `ACCOUNT_ADMIN` administra su organización (usuarios, oficinas, configuración) sin ver otras. SUPER_ADMIN no hereda permisos de ACCOUNT_ADMIN ni es un valor más del enum de roles de tenant; autorización de plataforma y de tenant separadas; acceso de soporte a datos de una organización explícito, limitado y auditado; auditoría propia y MFA obligatorio; **sin bypass implícito** del aislamiento multi-tenant. Primero un plan de migración compatible; no implementar bypass ni cambiar permisos por equivalencia. | Contrasta con el código (D-SA-1…): hoy es un valor del enum con todos los permisos, tratado igual que ACCOUNT_ADMIN salvo MFA. **TENSIÓN con R5** («solo el super admin crea oficinas»): si el super admin es de plataforma, ¿quién crea oficinas dentro de un tenant? Pendiente de la usuaria. |

### R12 · Quién administra oficinas (APROBADA por la usuaria, 2026-11-02: «me parece bien tu sugerencia») — reemplaza R5
Se decide por **capacidad (permiso)**, no por tipo de tenant (RULES C5).
- **Plataforma:** `SUPER_ADMIN` = equipo de Kobrax. Planes, suscripciones y estado de cuentas. Acceso de soporte a datos de un cliente solo explícito, limitado y auditado; MFA obligatorio; sin bypass del aislamiento. No opera oficinas del día a día. Sale de los roles de tenant (plan de migración aparte, antes de tocarlo).
- **Organización:** `ACCOUNT_ADMIN` (dueño) crea/mueve oficinas y niveles y asigna usuarios dentro de su organización, con permisos propios `office:write` / `office:read` (en lugar de `account:write` / `user:read`). `ACCOUNT_ADMIN` los trae por defecto: nadie pierde nada hoy.
- **Delegado:** un rol (p. ej. «Administrador de sistemas») puede recibir esos permisos; la delegación completa por rol es de F14. En F13 solo existen como permisos separados.
- **Planes:** el tope de oficinas por plan (FREE 1 · PROFESSIONAL 3 · BUSINESS 10, `LIMITES-POR-PLAN.md:149`) se aplica al crear; hoy no existe en código.
- Tenant individual: oficina implícita única, sin pantallas de jerarquía.
- Fuera de F13: construir el acceso de soporte del super admin (fase de seguridad).

### R13 · Gerente regional = MANAGER (requisito de la usuaria, 2026-11-02) — **PROPUESTA de solución pendiente de aprobar**
Requisito: en un banco el **gerente regional es el rol MANAGER** y el **SUPERVISOR depende del gerente**. Hoy `MANAGER` tiene `data:scope:all` (H-05-03) y solo `SUPERVISOR` obtiene alcance por oficina; con eso un gerente regional vería todo el banco.
Propuesta de la IA (equivalente en tenants actuales, sin romper nada):
1. Nueva capacidad `data:scope:subtree` = ve **todo el subárbol** de sus oficinas asignadas, **incluidos créditos sin responsable**. `data:scope:branch` (supervisor) conserva su regla actual (requiere responsable, `requireResponsible`).
2. Migración: `MANAGER` pasa de `data:scope:all` a `data:scope:subtree` **y cada MANAGER existente se asigna a la raíz** de su cuenta (la raíz cubre todo el árbol ⇒ ve exactamente lo mismo que hoy). Un MANAGER sin asignaciones ve solo lo suyo (A-4), nunca todo.
3. La dependencia supervisor→gerente es **estructural**: el supervisor está asignado a una agencia que cuelga de la regional del gerente. Sin línea de reporte aparte en F13.
4. Esto toca la frontera con F14 (cambia un rol existente): requiere tu aprobación explícita y entra a ADR-0002.
Pendiente: ¿AUDITOR y VIEWER se quedan en `data:scope:all` (propuesta: sí, son de lectura global de la cuenta)?

### R14 · Reasignación de cartera al ramificar (consecuencia de ADR-0004, 2026-11-02)
La raíz con cartera histórica debe **vaciarse hacia las nuevas oficinas** al crear la primera hija. Hace falta, antes de habilitar “crear oficina hija” en cuentas con cartera, la acción de **reasignación masiva** de créditos entre oficinas (D-5): con `assignment:write` y alcance sobre origen y destino, auditada, atómica por lote, los pagos previos intactos. D-5 pasa a ser prerrequisito de P2; su detalle espera tu confirmación.
Cuenta en el tope del plan: la raíz es 1 oficina (FREE=1 ⇒ el individual no crea agencias hasta subir de plan; PROFESSIONAL 3 = raíz + 2).

### R15 · Delegación para construir (2026-11-02, usuaria)
Mensajes: «si es necesario puedes tocar móvil» y «necesito que empieces con todas las fases hasta el final». Efecto: se autoriza avanzar G2→G3→fases y tocar el móvil **solo si hace falta**. **Supuestos adoptados por la IA sin respuesta explícita de la usuaria (revisables, a confirmar):** R13 (MANAGER con `data:scope:subtree` y asignación a la raíz), D-5/R14 (reasignación masiva con `assignment:write`, auditada, por lotes), AUDITOR/VIEWER siguen con alcance total, ADR-0002 como está propuesto. La IA los marca en cada entrega; si la usuaria los cambia, se corrige.

### Restricciones arquitectónicas (2026-11-02, usuaria) — se aprueban como restricciones, NO como modelo completo
| ID | Restricción |
|---|---|
| A-1 | Todo crédito debe tener una oficina válida. Se migran los existentes sin oficina y se añaden índices. |
| A-2 | `payments.branch_id` se conserva como registro **histórico**; cambiar un crédito de oficina no modifica la atribución de pagos anteriores. |
| A-3 | Separar **rol, permisos y alcance de asignación**. Revisar notificaciones, invitaciones y restricciones actuales antes de migrar. |
| A-4 | `ACCOUNT_ADMIN` sin oficinas conserva acceso total dentro de su tenant. Un `SUPERVISOR` sin oficina **no** obtiene acceso total. |
| A-5 | JWT no se modifica todavía; el contexto de oficina en el token queda para la fase de seguridad. |
| A-6 | El servidor determina y valida la oficina; nunca se confía en la enviada por el cliente. |
| A-7 | Oficina actual del crédito y oficina histórica del pago son dimensiones distintas. |
| A-8 | Ausencia de oficina ≠ ausencia de restricciones. |
| A-9 | No se rompen los tenants individuales existentes. |
| A-10 | Migración progresiva, compatible y verificable con pruebas. |

**Sin decidir (hay que presentarlas antes de implementar):** cómo asignar oficina a créditos históricos sin información suficiente · qué significa exactamente «solo lo suyo» para un supervisor sin oficina · cómo se reasignan créditos entre oficinas y quién puede · cómo se resuelve el acceso de soporte del super admin · qué pasa con reportes históricos y consolidados ante una reasignación.

Ya no quedan preguntas abiertas de las tres originales. Impacto en ADR-0002/0003/0004 pendiente de G2.
