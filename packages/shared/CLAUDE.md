# KOBRAX — Agente: Shared Package
# Ubicación: packages/shared/CLAUDE.md

## Responsabilidad
Todo lo que se comparte entre api, web y mobile.
Si está aquí → es la única fuente de verdad.

## Estructura
```
packages/shared/src/
├── types/
│   ├── auth.types.ts          # JwtPayload, AuthUser, Session
│   ├── case.types.ts          # CollectionCase, CaseActivity
│   ├── payment.types.ts       # Payment, PaymentMethod
│   ├── route.types.ts         # Route, Visit
│   ├── evidence.types.ts      # FieldEvidence, EvidenceType
│   └── analytics.types.ts     # KpiData, MetricCard
├── enums/
│   ├── case-status.enum.ts    # CaseStatus
│   ├── case-priority.enum.ts  # CasePriority
│   ├── evidence-type.enum.ts  # EvidenceType
│   ├── permission.enum.ts     # Permission (todos los permisos)
│   └── role.enum.ts           # RoleType
├── dtos/
│   ├── response.dto.ts        # ResponseDto<T>, PaginatedDto<T>
│   ├── pagination.dto.ts      # PaginationQuery
│   └── error.dto.ts           # ErrorDto, ErrorCode
├── constants/
│   ├── permissions.ts         # PERMISSIONS map
│   ├── case-transitions.ts    # Estados válidos de transición
│   └── kobrax.constants.ts    # App-wide constants
├── utils/
│   ├── hash.utils.ts          # SHA-256 (web crypto API, funciona en todos lados)
│   ├── date.utils.ts          # Formateo de fechas para Latinoamérica
│   └── currency.utils.ts      # Formateo de moneda (ARS, COP, MXN, PEN, BOB...)
└── index.ts                   # Re-exporta todo
```

## Enums Core

```typescript
// case-status.enum.ts
export enum CaseStatus {
  PENDING        = 'PENDING',
  ACTIVE         = 'ACTIVE',
  IN_NEGOTIATION = 'IN_NEGOTIATION',
  PROMISE_TO_PAY = 'PROMISE_TO_PAY',
  PAID           = 'PAID',
  CLOSED         = 'CLOSED',
  WRITTEN_OFF    = 'WRITTEN_OFF',
}

// Transiciones válidas (no se puede saltar estados arbitrariamente)
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.PENDING]:        [CaseStatus.ACTIVE],
  [CaseStatus.ACTIVE]:         [CaseStatus.IN_NEGOTIATION, CaseStatus.PROMISE_TO_PAY, CaseStatus.PAID, CaseStatus.WRITTEN_OFF],
  [CaseStatus.IN_NEGOTIATION]: [CaseStatus.PROMISE_TO_PAY, CaseStatus.ACTIVE, CaseStatus.WRITTEN_OFF],
  [CaseStatus.PROMISE_TO_PAY]: [CaseStatus.PAID, CaseStatus.ACTIVE],
  [CaseStatus.PAID]:           [CaseStatus.CLOSED],
  [CaseStatus.CLOSED]:         [],
  [CaseStatus.WRITTEN_OFF]:    [],
};
```

## ResponseDto (estándar de respuesta API)

```typescript
export class ResponseDto<T> {
  data: T | null;
  error: ErrorDto | null;
  meta: {
    timestamp: string;
    version: string;
    total?: number;
    page?: number;
    limit?: number;
    pages?: number;
  };

  static ok<T>(data: T, meta?: Partial<ResponseDto<T>['meta']>): ResponseDto<T> {
    return { data, error: null, meta: { timestamp: new Date().toISOString(), version: '1', ...meta } };
  }

  static paginated<T>(data: T[], total: number, page: number, limit: number): ResponseDto<T[]> {
    return {
      data,
      error: null,
      meta: { timestamp: new Date().toISOString(), version: '1', total, page, limit, pages: Math.ceil(total / limit) }
    };
  }

  static error(code: string, message: string, details?: unknown): ResponseDto<null> {
    return { data: null, error: { code, message, details }, meta: { timestamp: new Date().toISOString(), version: '1' } };
  }
}
```

## Hash Utils (funciona en Node, browser y React Native)

```typescript
export async function sha256(data: ArrayBuffer | string): Promise<string> {
  const buffer = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

## Currency Utils (multi-país Latinoamérica)

```typescript
export const SUPPORTED_CURRENCIES = {
  BOB: { name: 'Boliviano', symbol: 'Bs.', locale: 'es-BO' },
  COP: { name: 'Peso Colombiano', symbol: '$', locale: 'es-CO' },
  MXN: { name: 'Peso Mexicano', symbol: '$', locale: 'es-MX' },
  PEN: { name: 'Sol Peruano', symbol: 'S/', locale: 'es-PE' },
  ARS: { name: 'Peso Argentino', symbol: '$', locale: 'es-AR' },
  USD: { name: 'Dólar', symbol: '$', locale: 'en-US' },
} as const;

export function formatCurrency(amount: number, currency: keyof typeof SUPPORTED_CURRENCIES): string {
  const { locale } = SUPPORTED_CURRENCIES[currency];
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}
```

## Reglas del Package
- Zero dependencias externas pesadas (solo tipos y utilidades puras)
- Funciones puras únicamente (no side effects)
- Exportar todo desde index.ts
- Nunca importar desde `api`, `web` o `mobile` → solo ellos importan de `shared`
- Cambiar un tipo aquí → TypeScript marca todos los errores en todos los apps
