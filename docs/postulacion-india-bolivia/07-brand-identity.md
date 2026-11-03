# Kobrax — Brand Identity (para diapositivas)

> **Fecha:** 2026-10-12
> **Fuentes:** `packages/shared/src/design/tokens.ts` (fuente única de los tokens), `docs/design-system.md` (especificación vinculante),
> `apps/web/tailwind.config.ts`, `apps/mobile/src/theme.ts`, `apps/web/src/messages/es.json` y los `CLAUDE.md` de web, móvil y shared.
> **Uso:** referencia para construir las diapositivas de la postulación con la identidad real del producto.

---

## 1. Esencia

- **Producto:** Kobrax, sistema de gestión inteligente de cobranzas. Plataforma multi-tenant para Latinoamérica, desde cobradores independientes hasta bancos.
- **Filosofía visual:** fintech con **confianza institucional** (navy profundo) y **modernidad** (periwinkle y purple como acento, no como base). Prioriza la claridad operativa y la seguridad visible.
- **Regla de oro:** navy es el único color dominante. Todo lo demás es acento o estado.
- **Titular de marca (login web):** «Cobranza en campo, resultados en *tiempo real*».
- **Tagline:** «Kobrax es la plataforma que transforma tu gestión de cobranzas en eficiencia y resultados.»
- **Pilares de producto:** rutas optimizadas, trabajo offline, evidencia inmutable (foto, GPS y firma con hash SHA-256), auditoría completa.
- **Sello de confianza:** «Conexión cifrada TLS 1.3», siempre visible en las pantallas de acceso.

---

## 2. Logo

| Archivo | Ruta |
|---|---|
| Logo (PNG, 73 KB) | `apps/web/public/logo.png` (idéntico en `apps/mobile/assets/logo.png` y `apps/api/assets/logo.png`) |
| Ícono de la app (PNG, 1 MB) | `apps/mobile/assets/icon.png` |

- **Qué es:** un ícono de app, no un logotipo con texto. Una «K» azul con una flecha ascendente en purple, sobre un cuadrado redondeado navy oscuro con brillo.
- **Simbolismo:** la flecha hacia arriba representa recuperación y crecimiento.
- **Faltantes:** no hay wordmark «Kobrax», ni versión vectorial (SVG), ni reglas de área de seguridad o tamaño mínimo.
  Para las diapositivas, escribir «KOBRAX» o «Kobrax» en Inter 600 junto al ícono.

---

## 3. Paleta de color

### Primarios (identidad)

| Token | HEX | Uso |
|---|---|---|
| Navy | `#1A3A52` | Fondos hero, títulos, botón principal, sidebar |
| Slate | `#2B5A7D` | Medio del gradiente, hover |
| Periwinkle | `#5B7DBE` | Fin del gradiente, foco, info |
| Light blue | `#D8E5F2` | Bordes y fondos claros |

### Acentos purple

| Token | HEX | Uso |
|---|---|---|
| Purple | `#7B68D6` | Links, énfasis, elementos activos |
| Soft periwinkle | `#8B9FD6` | Apoyo |
| Very light purple | `#E0D8F2` | Fondos suaves |
| Highlight | `#F0ECFF` | Chips y badges |

### Apoyos informativos

| Token | HEX |
|---|---|
| Info bg | `#E8F0FB` |
| Teal | `#1B8A84` |
| Teal bg | `#E3F6F5` |

### Estados operativos (nunca para decoración)

| Estado | Color | Fondo | Texto |
|---|---|---|---|
| Éxito | `#27AE60` | `#E8F8F0` | — |
| Error | `#DC3545` | `#FCE8E8` | — |
| Alerta | `#F59E0B` | `#FFF3CD` | `#7A5C00` |

### Neutros

| Token | HEX |
|---|---|
| Texto principal | `#1A2B3E` |
| Texto secundario | `#5B7795` |
| Texto atenuado | `#8FA3B8` |
| Fondo claro | `#F8F9FB` |
| Fondo blanco | `#FAFBFD` |
| Borde | `#D8E5F2` |

### Gradientes

| Nombre | Definición | Uso |
|---|---|---|
| Hero | `linear-gradient(160deg, #1A3A52 0%, #2B5A7D 60%, #5B7DBE 100%)` | Portadas y heros (solo ahí) |
| CTA | `linear-gradient(90deg, #1A3A52 0%, #7B68D6 100%)` | Botón de acción principal |

**Sombra de tarjeta:** `0 8px 30px rgba(26,58,82,.08)`.
**Contraste:** texto blanco sobre el gradiente hero supera 7:1 (WCAG AA).

---

## 4. Tipografía

- **Familia:** Inter (pesos 400, 500, 600). JetBrains Mono para códigos y hashes. En móvil se usa la fuente del sistema (SF Pro o Roboto).
- **Peso máximo:** 600. No se usan negritas pesadas.

| Nivel | Tamaño | Peso | Color |
|---|---|---|---|
| Hero / H1 | 28 web (24 en el design system) | 600 | navy (blanco sobre hero) |
| H2 | 20–22 | 600 | navy |
| H3 | 17–18 | 500 | texto principal |
| Body | 14–15 | 400 | texto principal |
| Secundario | 13 | 400 | texto secundario |
| Caption | 11–12 | 400 | atenuado |
| Label | 11, MAYÚSCULAS, tracking amplio | 600 | texto principal |
| Link | 13 | 500 | purple |

Para diapositivas, escalar manteniendo las proporciones (títulos de 40–54 pt, cuerpo de 18–24 pt).

---

## 5. Forma, espaciado e iconografía

- **Radios:** botones e inputs 10 · cards 12–16 · modales y bottom-sheet 24 · pills 4 o 999 · curva blanca del hero 28–36.
- **Espaciado:** grid de 4 px (4, 8, 12, 16, 20, 24, 28, 32, 40, 48).
- **Botón primario:** navy, texto blanco, peso 500, hover slate.
- **Inputs:** borde de 1,5 px light blue; foco en periwinkle con anillo `rgba(91,125,190,.15)`.
- **Hero de acceso:** gradiente con curva blanca arriba y chip de seguridad con candado.
- **Íconos:** Tabler (web) e Ionicons (móvil), de 14 a 18 px, en gris azulado. No usar emojis como iconografía.

---

## 6. Tono y principios

El tono no está documentado formalmente; se infiere del producto:

- Español neutro latinoamericano, directo y profesional, sin jerga.
- «Sol → contraste, no decoración»: el dato accionable siempre en navy o texto principal.
- «Premium ≠ recargado»: cada animación o adorno confirma una acción o no va.
- «Evidencia inmutable» y «offline-first» como promesas centrales.

---

## 7. Aplicación a las diapositivas

| Elemento | Indicación |
|---|---|
| Portada y cierre | Fondo con gradiente hero, texto blanco, logo centrado o a la izquierda |
| Contenido | Fondo `#F8F9FB` o `#FAFBFD`, títulos navy, cuerpo `#1A2B3E` |
| Acento | Purple `#7B68D6` para una palabra clave por lámina (como «tiempo real») |
| Tarjetas | Fondo blanco, radio 12–16, sombra de tarjeta |
| Gráficos | Serie principal navy, luego periwinkle y purple. Verde y rojo solo para éxito y error |
| Fuente | Instalar Inter en la máquina que presenta; respaldo Calibri o Arial |
| Capturas | De la demo `kobrax.ikigaisystems.lat`, no del extracto real `docs/flows/mora union.PDF` |

---

## 8. Notas y decisiones menores

- **Móvil:** usa blanco puro `#FFFFFF` en las cards (contraste bajo el sol), mientras el sistema define `#FAFBFD`. Es intencional (P0 D2).
- **H1:** 24 en `design-system.md` y 28 en la web. Para láminas no tiene efecto.
- **Pendiente de marca:** wordmark, logo vectorial y reglas de uso del logo. Si la postulación los necesita, hay que diseñarlos; hoy no existen en el repo.
