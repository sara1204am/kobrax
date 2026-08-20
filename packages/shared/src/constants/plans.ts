/**
 * Los planes comerciales y sus topes.
 *
 * Los números son los que cerró la dueña sobre `docs/business/LIMITES-POR-PLAN.md` (§4-A). Viven
 * acá y no en cada app porque la web, el móvil y —cuando exista la tabla `plans`— la API tienen
 * que decir **el mismo número**: una segunda copia se desincroniza el día que se cambia un precio.
 *
 * ⚠️ Esto es el **catálogo**, no la guarda. Hoy el único tope que el servidor hace cumplir es el de
 * usuarios, y lo hace con `accounts.max_users` (una columna suelta por cuenta), no con esta tabla.
 * Mostrar un tope de acá describe lo que el plan incluye; **no** significa que algo lo cuente.
 *
 * Sin `branches`: la función no existe en el producto (LIMITES §5.6) y un tope de algo que no se
 * puede usar no se muestra.
 */

export type PlanCode = 'FREE' | 'PROFESSIONAL' | 'BUSINESS' | 'ENTERPRISE';

/**
 * Un tope. `null` = sin límite.
 *
 * 🔴 **Ningún plan SaaS usa `null`, ni siquiera ENTERPRISE.** Un tope sin número no se cuenta, así
 * que tampoco se ve: nadie se entera de que un cliente consume cinco veces lo cotizado hasta que lo
 * dice la base de datos. Y en multi-tenant, un inquilino sin techo es un riesgo compartido — un
 * extracto mal armado con dos millones de filas degrada la base donde viven todos los demás.
 *
 * `null` queda reservado para **Kobrax Licencia**, que es el único caso en que de verdad no hay
 * nada que hacer cumplir: corre en el servidor del cliente y no vemos nada (LIMITES §7).
 */
export type PlanLimit = number | null;

export interface PlanLimits {
  users: PlanLimit;
  /** Con saldo pendiente y sin dar de baja (LIMITES §5.2). Es el tope que mide el trabajo real. */
  credits: PlanLimit;
  /**
   * Deudores. ⚠️ Con el mismo número que `credits` **casi nunca alcanza a frenar nada**: un cliente
   * puede deber varios créditos, así que el tope de créditos se llena primero. Sólo muerde en la
   * cartera cargada sin préstamos.
   */
  clients: PlanLimit;
  photosPerMonth: PlanLimit;
  photoRetentionMonths: PlanLimit;
  /** Visitas y contactos. **Nunca puede bloquear**: la gestión llega de campo, sin internet, ya
   * ocurrida (LIMITES §5.3). Es un número para avisar, no para frenar. */
  actionsPerMonth: PlanLimit;
}

export interface Plan {
  code: PlanCode;
  /** USD al mes: `base` + `perSeat` × miembro. */
  price: { base: number; perSeat: number };
  limits: PlanLimits;
}

export const PLANS: Record<PlanCode, Plan> = {
  FREE: {
    code: 'FREE',
    price: { base: 0, perSeat: 0 },
    limits: {
      users: 1,
      credits: 20,
      clients: 20,
      photosPerMonth: 100,
      photoRetentionMonths: 6,
      actionsPerMonth: 100,
    },
  },
  PROFESSIONAL: {
    code: 'PROFESSIONAL',
    price: { base: 0, perSeat: 12 },
    limits: {
      users: 25,
      credits: 1000,
      clients: 1000,
      photosPerMonth: 5000,
      photoRetentionMonths: 24,
      actionsPerMonth: 2500,
    },
  },
  BUSINESS: {
    code: 'BUSINESS',
    price: { base: 99, perSeat: 10 },
    limits: {
      users: 100,
      credits: 5000,
      clients: 5000,
      photosPerMonth: 25000,
      photoRetentionMonths: 60,
      actionsPerMonth: 12500,
    },
  },
  /**
   * ENTERPRISE **no es ilimitado: es a medida.** Estos números son el **piso** —lo que incluye el
   * precio de partida—, y el contrato de cada cliente los sube en su propia cuenta
   * (`limits_override`, LIMITES §8.2). Que exista un número es lo que hace que el consumo se
   * cuente, que el aviso del 80% pueda saltar y que la conversación de ampliación llegue antes que
   * la sorpresa.
   *
   * El precio también lleva **por asiento**, y no es un detalle: con un monto plano, el ingreso se
   * congela mientras el cliente crece — que es exactamente lo que el «ilimitado» apagaba. Además
   * corrige una inversión de la grilla vieja: BUSINESS con 80 cobradores costaba $899, más que el
   * piso plano de $800 de ENTERPRISE, así que a partir de ~71 cobradores convenía pedir el plan de
   * arriba. Lo que ve el cliente en pantalla sigue siendo «a medida»: el número vive en el
   * contrato, no en la app.
   */
  ENTERPRISE: {
    code: 'ENTERPRISE',
    price: { base: 800, perSeat: 8 },
    limits: {
      users: 500,
      credits: 50_000,
      clients: 50_000,
      photosPerMonth: 250_000,
      // ⚠️ 120 meses es simetría con la escalera, no normativa. El número real sale de cuánto
      // exige ASFI que guarden las entidades que lo van a comprar.
      photoRetentionMonths: 120,
      actionsPerMonth: 125_000,
    },
  },
};

/** La escalera, de abajo hacia arriba. El orden es comercial, no alfabético. */
export const PLAN_ORDER: PlanCode[] = ['FREE', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'];

/**
 * Los planes que se pueden elegir **al registrarse**.
 *
 * 🔴 `ENTERPRISE` queda afuera a propósito y esto no es cosmético: `POST /accounts` es un endpoint
 * **público, sin sesión**, así que el plan que llega en el cuerpo es entrada no confiable. Dejarlo
 * elegible sería regalarle topes ilimitados a quien mande el código con `curl`. Su precio se cotiza
 * (LIMITES-POR-PLAN §4-B): la tarjeta lo muestra, pero se contesta hablando.
 *
 * La lista vive una sola vez: la usan el DTO de la API y las dos pantallas de registro.
 */
export const SIGNUP_PLANS = ['FREE', 'PROFESSIONAL', 'BUSINESS'] as const;
export type SignupPlan = (typeof SIGNUP_PLANS)[number];

export function isSignupPlan(code: unknown): code is SignupPlan {
  return typeof code === 'string' && (SIGNUP_PLANS as readonly string[]).includes(code);
}

/**
 * Días de prueba de un plan pago elegido al registrarse. Al vencer, la cuenta **cae a FREE**: no se
 * bloquea, no se pierde nada. Es lo que evita regalar un plan pago mientras no haya pasarela de
 * cobro (LIMITES-BUILD-PLAN §L0.5).
 */
export const TRIAL_DAYS = 30;

/**
 * El plan de un `account.planCode`.
 *
 * `STARTER` es como se llama el FREE **en la base**: el enum de Prisma todavía dice `STARTER` y
 * renombrarlo es una migración aparte. Se traduce acá para que ninguna pantalla tenga que saberlo.
 *
 * Devuelve `undefined` para un código desconocido en vez de caer al FREE: inventarle un plan chico
 * a una cuenta ajena es peor que no mostrar nada.
 */
export function planOf(code: string): Plan | undefined {
  return PLANS[(code === 'STARTER' ? 'FREE' : code) as PlanCode];
}

/** El escalón de arriba, o `undefined` si ya está en el último. */
export function nextPlan(code: string): Plan | undefined {
  const plan = planOf(code);
  const next = plan ? PLAN_ORDER[PLAN_ORDER.indexOf(plan.code) + 1] : undefined;
  return next ? PLANS[next] : undefined;
}

/** Al 80% se avisa (LIMITES §8.6). */
export const PLAN_WARN_AT = 0.8;

/** Qué tan cerca del tope está un consumo. Sin tope no hay alarma que dar. */
export function usageLevel(used: number, max: PlanLimit): 'ok' | 'near' | 'full' {
  if (max === null) return 'ok';
  if (used >= max) return 'full';
  return used / max >= PLAN_WARN_AT ? 'near' : 'ok';
}
