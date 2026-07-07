# KOBRAX — Agente: App Mobile (Cobrador en Campo)
# Ubicación: apps/mobile/CLAUDE.md

## Contexto de Uso Crítico
El cobrador opera en campo: zonas con señal débil, manos ocupadas, sol directo.
La app DEBE funcionar sin internet. La UX debe ser de máxima simplicidad.

## Stack Mobile
- React Native 0.74 + Expo SDK 51 · TypeScript strict
- **Estilos: StyleSheet + design tokens** (`src/theme.ts`, espejo de `packages/shared` / `design-system.md`).
  > Nota (2026-06-18): este doc previó NativeWind, pero el código se estandarizó en **StyleSheet + tokens**
  > (ver `components.tsx`). Esa es la base vigente; **no** se reintroduce NativeWind ni se migra a Tamagui/Paper.
- **Navegación: expo-router** (file-based, sobre React Navigation) + Reanimated para transiciones
- WatermelonDB — almacenamiento local offline (F10)
- Expo Location (GPS) · Expo Camera + ImageManipulator (fotos ≤ 800 KB) · Expo FileSystem (firmas base64)
- NetInfo (conectividad) · Zustand (estado global) · React Query + sync layer propio (F10)

### Capa de UI premium (calidad sin peso) — decisión 2026-06-18
Objetivo: la app **se siente fluida y premium en un teléfono barato bajo el sol**, sin traicionar
offline-first ni la simplicidad del cobrador. Lo premium viene del **craft**, no de una librería pesada.
- **Reanimated 3** — microinteracciones en UI thread (press, transiciones, skeletons, slide del banner offline). Da ~80% de la sensación premium sin costar fluidez.
- **react-native-gifted-charts** (NO Victory XL / Skia) — solo 1–2 visuales que el cobrador valora (anillo de progreso/meta del día). Ligero, sin dependencia Skia.
- **expo-haptics** — feedback sutil al registrar pago/visita. Se *siente* premium, peso ~0.
- **FlashList** (no FlatList) para listas de casos.
- ❌ Descartados: **Tamagui / React Native Paper** (reescriben la base de tokens, look genérico no-marca, peso) y **Skia + Victory Native XL como base** (peso de build/bundle, jank en gama baja). Skia queda como opción futura solo si aparece un visual custom que lo justifique.

### Tres reglas de diseño (las impone "premium bajo el sol en gama baja")
1. **Sol → contraste, no decoración.** El dato accionable (monto, nombre, días de mora) siempre en `navy`/`textPrimary`; los grises suaves (`textMuted`/`textSecondary`) solo para labels secundarios. Contraste ≥ 4.5:1.
2. **Gama baja → presupuesto de performance explícito.** Arranque < 2 s, listas a 60 fps, animación **solo** en UI thread (Reanimated, nunca `Animated` de JS), y desactivable si el device es lento o `Reduce Motion` está activo.
3. **Premium ≠ recargado → animación con propósito.** Cada microinteracción confirma una acción (press, check al guardar pago, slide del banner). Animación sin función = batería gastada + percepción de lento.

## Principio Offline-First (NO NEGOCIABLE)
```
Toda acción del cobrador:
1. Se guarda PRIMERO en WatermelonDB local
2. Se marca como pendiente de sync (syncStatus: 'pending')
3. Se muestra en UI inmediatamente (optimistic update)
4. Cuando hay internet → SyncService sube los cambios
5. Conflictos: last-write-wins con timestamp del servidor

NUNCA bloquear una acción del cobrador esperando respuesta de red.
```

## Estructura de Carpetas
> **Navegación real: expo-router (file-based).** Tabs = componente nativo `Tabs` de
> expo-router (cubre el TabBar del diseño, teñido con tokens); no hay renderer de tab bar propio.
> Set de tabs = **Figma `42:3069`** (ver [`docs/epics/F10/ui-screen-map.md §6`](../../docs/epics/F10/ui-screen-map.md)):
> **Inicio · Agenda · Rutas · Cobranza · Más** — *no* `route/cases/payments/profile`.
> "Casos" no es tab (vive bajo Agenda/Inicio); Pagos → "Cobranza"; Perfil → dentro de "Más".

```
apps/mobile/
├── app/                          # expo-router (file-based)
│   ├── (auth)/                   # login, mfa, mfa-setup, select-account, forgot, unlock, biometric-setup
│   ├── (app)/                    # offline, force-password-change (fuera de tabs)
│   ├── (tabs)/                   # shell de campo — 5 tabs (Slice 0)
│   │   ├── _layout.tsx           # <Tabs> nativo + tokens + íconos Ionicons
│   │   ├── index.tsx             # Inicio (Home/Jornada)
│   │   ├── agenda.tsx            # Agenda diaria de gestiones
│   │   ├── rutas.tsx             # Rutas del día (mapas en dev build)
│   │   ├── cobranza.tsx          # Pagos / cobros en campo
│   │   └── mas.tsx               # Overflow: perfil, config, import (gating por rol en F3)
│   ├── _layout.tsx  index.tsx    # root + splash
└── src/                          # lógica y UI (layout PLANO, no por dominio)
    ├── theme.ts                  # tokens (espejo de packages/shared / design-system.md)
    ├── components.tsx            # UI de auth (Button, Field, Hero, Card, ...)
    ├── ui.tsx                    # fundación de campo: Header, StatusBadge, ListRow, EmptyState, BottomSheet
    ├── api.ts  auth-service.ts  session.ts  biometric.ts  post-login.ts
    └── (por slice) sync.service.ts · evidence.service.ts · location.service.ts · database/ (WatermelonDB) · store/ (Zustand)
```

## Design System Mobile (Kobrax Tokens)

### Colores (NativeWind custom config)
```javascript
// tailwind.config.js
colors: {
  'k-navy':        '#1A3A52',
  'k-slate':       '#2B5A7D',
  'k-periwinkle':  '#5B7DBE',
  'k-light-bg':    '#D8E5F2',
  'k-purple':      '#7B68D6',
  'k-soft-periw':  '#8B9FD6',
  'k-highlight':   '#F0ECFF',
  'k-bg':          '#F8F9FB',
  'k-text':        '#1A2B3E',
  'k-text-2':      '#5B7795',
  'k-text-muted':  '#8FA3B8',
  'k-success':     '#27AE60',
  'k-success-bg':  '#E8F8F0',
  'k-danger':      '#DC3545',
  'k-danger-bg':   '#FCE8E8',
  'k-border':      '#D8E5F2',
}
```

### Tipografía
```
H1: 24px / 600 / k-navy
H2: 20px / 600 / k-navy
H3: 17px / 600 / k-text
Body: 15px / 400 / k-text       ← mínimo en mobile
Secondary: 13px / 400 / k-text-2
Caption: 12px / 400 / k-text-muted  ← mínimo absoluto
```

### Componentes Base

**Button**
```tsx
// Variantes: primary | secondary | ghost | danger
// Tamaño mínimo: height 52px (cobrador con guantes)
<Button variant="primary" onPress={handleSubmit}>
  Registrar Pago
</Button>
```

**CaseCard**
```tsx
// Muestra: nombre deudor, monto, días mora, estado, distancia
// Tap → navega a detalle del caso
```

**EvidenceCapture**
```tsx
// Siempre captura: foto + GPS + timestamp
// Comprime foto a max 800KB antes de guardar
// Calcula SHA-256 del buffer original ANTES de comprimir
// Hash se guarda en DB; foto comprimida se sube a S3
```

**SignatureCapture**
```tsx
// Canvas de firma con expo-signature-canvas
// Exporta como PNG base64
// Hash SHA-256 generado del base64
// Timestamp del dispositivo + coordenadas GPS incluidos
```

**OfflineIndicator**
```tsx
// Banner rojo/amarillo cuando no hay internet
// Muestra: "Sin conexión · X acciones pendientes de sync"
// Solo informativo, NO bloquea ninguna acción
```

## Permisos Requeridos (app.json)
```json
{
  "plugins": [
    ["expo-location", { "locationAlwaysAndWhenInUsePermission": "Kobrax necesita tu ubicación para registrar visitas de cobranza" }],
    ["expo-camera", { "cameraPermission": "Kobrax necesita la cámara para registrar evidencia de visitas" }]
  ],
  "android": {
    "permissions": ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "CAMERA"]
  }
}
```

## Flujo de Evidencia Digital
```
1. Cobrador toca "Registrar Visita"
2. App obtiene GPS → lat, lng, accuracy, timestamp
3. Si se requiere foto → CameraCapture
   a. Captura imagen
   b. Calcula SHA-256 del buffer original
   c. Comprime a max 800KB (ImageManipulator)
   d. Guarda en WatermelonDB con syncStatus: 'pending'
4. Si se requiere firma → SignatureCapture
   a. Canvas de firma
   b. Export PNG base64
   c. SHA-256 del base64
5. Actividad guardada localmente
6. SyncService sube cuando hay conexión
7. API verifica hash antes de persistir → rechaza si hash no coincide
```

## SyncService (lógica central)
```typescript
// Ejecuta cada 30 segundos si hay internet
// Cola de sync: FIFO por createdAt
// Retry: 3 intentos con backoff exponencial
// Conflictos: resolver con timestamps
// En error de auth: redirigir a login
// Nunca perder datos locales ante fallo de sync
```

## Seguridad Mobile
- Tokens JWT guardados en SecureStore (Expo), nunca en AsyncStorage
- Biometría opcional para abrir la app (expo-local-authentication)
- Timeout de sesión: 8 horas de inactividad
- PIN de respaldo si biometría no disponible
- Certificado SSL pinning en requests a la API
