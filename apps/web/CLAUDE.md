# KOBRAX — Agente: Panel Web (Supervisores / Gerencia)
# Ubicación: apps/web/CLAUDE.md

## Responsabilidad
Panel de administración para supervisores, gerentes y dirección ejecutiva.
Dashboards en tiempo real, gestión de cartera, reportes, configuración.

## Stack Web
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui (componentes base)
- Recharts (gráficos y dashboards)
- TanStack Query (data fetching y cache)
- Socket.io-client (supervisión en tiempo real)
- Zustand (estado global: tenant activo, usuario, permisos)
- React Hook Form + Zod (formularios)
- next-auth (sesión del panel web)

## Estructura App Router
```
src/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Sidebar + header
│   │   ├── page.tsx                # Dashboard principal
│   │   ├── cases/
│   │   │   ├── page.tsx            # Lista de casos
│   │   │   └── [id]/page.tsx       # Detalle caso
│   │   ├── collectors/page.tsx     # Supervisión de cobradores
│   │   ├── routes/page.tsx         # Gestión de rutas
│   │   ├── payments/page.tsx       # Registro y conciliación
│   │   ├── analytics/page.tsx      # KPIs y reportes
│   │   └── settings/
│   │       ├── users/page.tsx
│   │       ├── roles/page.tsx
│   │       └── account/page.tsx
├── components/
│   ├── ui/                         # shadcn/ui base
│   ├── layout/                     # Sidebar, Header, Breadcrumb
│   ├── dashboard/                  # MetricCard, KpiChart, ActivityFeed
│   ├── cases/                      # CaseTable, CaseStatusBadge, CaseFilters
│   ├── map/                        # CollectorMap (mapa en tiempo real)
│   └── forms/                      # Formularios de cada entidad
├── lib/
│   ├── api.ts                      # Cliente fetch tipado
│   ├── socket.ts                   # Socket.io client
│   └── auth.ts                     # next-auth config
└── hooks/
    ├── useRealtime.ts               # WebSocket subscriptions
    ├── usePermissions.ts            # RBAC en frontend
    └── useTenant.ts                 # Tenant activo
```

## Design System Web (Kobrax Tokens en Tailwind)

```javascript
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      'k-navy':       '#1A3A52',
      'k-slate':      '#2B5A7D',
      'k-periwinkle': '#5B7DBE',
      'k-light-bg':   '#D8E5F2',
      'k-purple':     '#7B68D6',
      'k-highlight':  '#F0ECFF',
      'k-bg':         '#F8F9FB',
      'k-text':       '#1A2B3E',
      'k-text-2':     '#5B7795',
      'k-muted':      '#8FA3B8',
      'k-border':     '#D8E5F2',
      'k-success':    '#27AE60',
      'k-danger':     '#DC3545',
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      mono: ['JetBrains Mono', 'monospace'],
    }
  }
}
```

## Componentes Clave

### MetricCard
```tsx
// Muestra KPI con valor, delta y tendencia
// Fondo: bg-k-bg, borde: border-k-border
// Valor: text-2xl font-semibold text-k-navy
// Delta positivo: text-k-success / negativo: text-k-danger
```

### CaseStatusBadge
```tsx
const variants = {
  PENDING:        'bg-k-light-bg text-k-slate',
  ACTIVE:         'bg-blue-50 text-blue-700',
  IN_NEGOTIATION: 'bg-k-highlight text-k-purple',
  PROMISE_TO_PAY: 'bg-amber-50 text-amber-700',
  PAID:           'bg-k-success-bg text-k-success',   // #E8F8F0
  CLOSED:         'bg-gray-100 text-gray-600',
  WRITTEN_OFF:    'bg-k-danger-bg text-k-danger',
}
```

### CollectorMap (tiempo real)
```tsx
// Mapa de cobradores activos via WebSocket
// Actualiza posición GPS cada 60 segundos
// Icono diferente: en ruta / visitando / regresando
// Click en cobrador → panel lateral con su actividad del día
```

### Sidebar
```tsx
// Fondo: bg-k-navy
// Íconos y texto: text-white/70 (inactivo) / text-white (activo)
// Item activo: bg-k-slate border-l-2 border-white
// Logo Kobrax arriba, menú usuario abajo
```

## Tipografía Web
```
H1: 28px / 600 / k-navy    → Títulos de página
H2: 22px / 600 / k-navy    → Secciones
H3: 18px / 500 / k-text    → Subsecciones
Body: 14px / 400 / k-text  → Contenido general
Small: 12px / 400 / k-muted → Labels, helpers
```

## Control de Permisos en UI
```tsx
// Hook usePermissions() verifica RBAC antes de renderizar
const { can } = usePermissions();

// Ocultar elemento si no tiene permiso
{can('case:write') && <Button>Asignar caso</Button>}

// Redirigir si ruta no permitida
// En layout: verificar rol antes de renderizar children
```

## Realtime (WebSocket)
```typescript
// Suscripciones por página:
// /dashboard     → payment.registered, case.updated
// /collectors    → collector.location (actualiza mapa)
// /cases/[id]   → case.updated, activity.added
// Reconexión automática con backoff
// Toast de notificación en eventos importantes
```

## Server vs Client Components
```
Server Components: páginas con data inicial (SEO, primera carga rápida)
Client Components: interactividad, realtime, formularios, gráficos
Regla: server por defecto, 'use client' solo cuando es necesario
```
