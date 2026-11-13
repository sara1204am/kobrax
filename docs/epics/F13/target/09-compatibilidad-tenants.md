# Objetivo · 09 · Compatibilidad por perfil de tenant

> **Estado: BORRADOR G2 (2026-11-02).** Depende de ADR-0004 (PROPUESTA: raíz «Principal» para todos con interfaz oculta). Evidencia: H-datos-09, H-05-10, H-02-09, H-07-10.

## Pregunta que responde
¿Qué garantiza que el tenant gratuito individual (y el de equipo) sigue trabajando igual?

## Garantías de diseño
1. **El individual no configura nada**: al registrarse recibe `ACCOUNT_ADMIN` dueño (H-datos-09) y una oficina raíz «Principal» creada por el sistema.
2. **No ve jerarquía** mientras tenga una sola oficina: sin pestaña de árbol, selectores ni columnas (04).
3. **Capacidad, no tipo de tenant** (C5): ninguna rama `if tenantType`; lo decide permiso + cantidad de oficinas + plan.
4. **Mismo resultado que hoy**: el servicio de alcance corre en modo equivalente (02, `requireResponsible`) y se prueba caso por caso (R-8).
5. **Migraciones aditivas** y reversibles; el servidor completa la oficina, el cliente no cambia.

## Matriz perfil × capacidad
| Capacidad | Individual (FREE) | Equipo / agencia pequeña | Grande |
|---|---|---|---|
| Oficinas | 1 (Principal, oculta) | 2–10 según plan (1/3/10) | ilimitadas según contrato |
| Ver/crear árbol | no | sí, plano o 2 niveles | sí |
| Usuarios en varias oficinas | no aplica | posible | sí (R3) |
| Alcance de datos | todo (admin) | admin ALL; supervisor su oficina | por subárbol |
| Analítica | cuenta completa | admin completa; supervisor su alcance | consolidados por nodo |
| Cambio de plan | sin efecto en oficinas | topes al crear | — |

## Regresión del individual (RULES C4) — lista de flujos
Cada uno debe dar el **mismo resultado antes y después**, con salida pegada en `execution/VERIFICATIONS.md`:
1. Registro de cuenta → queda `ACCOUNT_ADMIN` dueño y entra al panel.
2. Crear cliente.
3. Crear crédito **sin enviar oficina** → queda en la raíz.
4. Registrar pago → hereda oficina del crédito.
5. Mora: lista, ficha, gestión, promesa.
6. Agenda y ruta del día.
7. Importar cartera por archivo.
8. Dashboard: cifras idénticas.
9. Exportar.
10. Cambio de plan Individual → Equipo (sin pérdida de datos).
11. Móvil: hidratar y cobrar sin red (suite móvil).
12. Aislamiento: otra cuenta no ve nada.
La pantalla de Equipo/Cuenta no muestra elementos de jerarquía.

## Pendiente de aprobar
ADR-0004 (raíz materializada para todos). Alternativa si no se aprueba: raíz solo implícita, incompatible con A-1.

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | 1 fila de oficina (invisible) | todo flujo | R-1 (12 flujos) |
| Equipo / agencia pequeña | agencias bajo una raíz; asignaciones espejo | quién ve qué | R-2, R-8 |
| Grande | árbol real | aislamiento | R-3…R-5 |

## Entradas HUB que cambiarían
Registro de cuenta (`accounts.service.ts`), plan (`plans.ts`), todas las del resto de `target/`.
