import { describe, expect, it } from 'vitest';
import { RouteStatus, RouteStopStatus } from '../enums/index.js';
import {
  ROUTE_REASON_MAX,
  ROUTE_TRANSITIONS,
  canTransitionRoute,
  canTransitionStop,
  isOpenStop,
  isValidReason,
  routeIsOpen,
} from './route-rules.js';

describe('ROUTE_TRANSITIONS · el ciclo de vida de una ruta', () => {
  it('planificada → en curso | cancelada; en curso → completada | cancelada', () => {
    expect(canTransitionRoute(RouteStatus.PLANNED, RouteStatus.IN_PROGRESS)).toBe(true);
    expect(canTransitionRoute(RouteStatus.PLANNED, RouteStatus.CANCELLED)).toBe(true);
    expect(canTransitionRoute(RouteStatus.IN_PROGRESS, RouteStatus.COMPLETED)).toBe(true);
    expect(canTransitionRoute(RouteStatus.IN_PROGRESS, RouteStatus.CANCELLED)).toBe(true);
  });

  it('🔴 no se completa lo que nunca se inició', () => {
    expect(canTransitionRoute(RouteStatus.PLANNED, RouteStatus.COMPLETED)).toBe(false);
  });

  it('🔴 completada y cancelada son finales: una ruta cerrada no se reabre', () => {
    for (const from of [RouteStatus.COMPLETED, RouteStatus.CANCELLED]) {
      expect(ROUTE_TRANSITIONS[from]).toEqual([]);
      for (const to of Object.values(RouteStatus)) expect(canTransitionRoute(from, to)).toBe(false);
    }
  });

  it('nunca se vuelve a planificada', () => {
    for (const from of Object.values(RouteStatus)) expect(canTransitionRoute(from, RouteStatus.PLANNED)).toBe(false);
  });

  it('solo planificada y en curso están abiertas', () => {
    expect(routeIsOpen(RouteStatus.PLANNED)).toBe(true);
    expect(routeIsOpen(RouteStatus.IN_PROGRESS)).toBe(true);
    expect(routeIsOpen(RouteStatus.COMPLETED)).toBe(false);
    expect(routeIsOpen(RouteStatus.CANCELLED)).toBe(false);
  });
});

describe('STOP_TRANSITIONS · las paradas', () => {
  it('🔴 a visitada NO se llega a secas: se registra la visita', () => {
    for (const from of Object.values(RouteStopStatus)) expect(canTransitionStop(from, RouteStopStatus.VISITED)).toBe(false);
  });

  it('visitada y saltada son finales', () => {
    for (const from of [RouteStopStatus.VISITED, RouteStopStatus.SKIPPED]) {
      for (const to of Object.values(RouteStopStatus)) expect(canTransitionStop(from, to)).toBe(false);
    }
  });

  it('pendiente ↔ en camino, y cualquiera de las dos se puede saltar', () => {
    expect(canTransitionStop(RouteStopStatus.PENDING, RouteStopStatus.IN_ROUTE)).toBe(true);
    expect(canTransitionStop(RouteStopStatus.IN_ROUTE, RouteStopStatus.PENDING)).toBe(true);
    expect(canTransitionStop(RouteStopStatus.PENDING, RouteStopStatus.SKIPPED)).toBe(true);
    expect(canTransitionStop(RouteStopStatus.IN_ROUTE, RouteStopStatus.SKIPPED)).toBe(true);
  });

  it('«sin gestionar» es pendiente o en camino', () => {
    expect(isOpenStop(RouteStopStatus.PENDING)).toBe(true);
    expect(isOpenStop(RouteStopStatus.IN_ROUTE)).toBe(true);
    expect(isOpenStop(RouteStopStatus.VISITED)).toBe(false);
    expect(isOpenStop(RouteStopStatus.SKIPPED)).toBe(false);
  });
});

describe('isValidReason · el motivo escrito', () => {
  it('vale si dice algo', () => {
    expect(isValidReason('Me enfermé')).toBe(true);
    expect(isValidReason('  Se acabó el tiempo  ')).toBe(true);
  });

  it('un punto, espacios o nada no son un motivo', () => {
    expect(isValidReason('.')).toBe(false);
    expect(isValidReason('    ')).toBe(false);
    expect(isValidReason('ok')).toBe(false);
    expect(isValidReason('')).toBe(false);
    expect(isValidReason(undefined)).toBe(false);
    expect(isValidReason(null)).toBe(false);
  });

  it('tiene tope', () => {
    expect(isValidReason('a'.repeat(ROUTE_REASON_MAX))).toBe(true);
    expect(isValidReason('a'.repeat(ROUTE_REASON_MAX + 1))).toBe(false);
  });
});
