import { describe, expect, it } from 'vitest'
import {
  CLIENT_ERROR_PLATFORMS,
  CLIENT_ERROR_SCOPE_KINDS,
  CLIENT_ERROR_SEVERITIES,
  CLIENT_ERROR_SOURCES,
  DIAGNOSTIC_CODES,
  CLIENT_ERROR_COMPONENTS,
  CLIENT_ERROR_REQUEST_CLASSES,
  isClientErrorComponent,
  isClientErrorRequestClass,
} from '../clientErrorContract'

describe('taxonomía del reporter de errores de cliente', () => {
  // La lista es append-only y está validada en tres capas: clasificador,
  // allowlist del endpoint y CHECK de la base. Este snapshot es la copia de
  // TypeScript; si cambia, las otras dos tienen que cambiar en el mismo orden
  // —base, endpoint, cliente— o el drift rompe en CI.
  it('congela los nueve diagnostic_code y su orden', () => {
    expect(DIAGNOSTIC_CODES).toEqual([
      'chunk_load',
      'network_failure',
      'timeout',
      'render_failure',
      'storage_failure',
      'data_parse_failure',
      'third_party_failure',
      'unknown',
      'sync_contract_failure',
    ])
  })

  it('congela las cuatro fuentes', () => {
    expect(CLIENT_ERROR_SOURCES).toEqual([
      'window_error',
      'unhandled_rejection',
      'react_boundary',
      'sync_failure',
    ])
  })

  it('congela los tres niveles de severidad', () => {
    expect(CLIENT_ERROR_SEVERITIES).toEqual(['alta', 'media', 'baja'])
  })

  it('congela los dos scope_kind', () => {
    expect(CLIENT_ERROR_SCOPE_KINDS).toEqual(['self', 'managed'])
  })

  it('congela las dos plataformas', () => {
    expect(CLIENT_ERROR_PLATFORMS).toEqual(['web', 'ios'])
  })

  it('expone conjuntos inmutables', () => {
    expect(Object.isFrozen(DIAGNOSTIC_CODES)).toBe(true)
    expect(Object.isFrozen(CLIENT_ERROR_SOURCES)).toBe(true)
    expect(Object.isFrozen(CLIENT_ERROR_SEVERITIES)).toBe(true)
  })

  it('no repite valores en ninguna lista', () => {
    for (const lista of [
      DIAGNOSTIC_CODES,
      CLIENT_ERROR_SOURCES,
      CLIENT_ERROR_SEVERITIES,
      CLIENT_ERROR_SCOPE_KINDS,
      CLIENT_ERROR_PLATFORMS,
    ]) {
      expect(new Set(lista).size).toBe(lista.length)
    }
  })
})

describe('etiquetas de integración y clases de request', () => {
  it('congela las etiquetas de componente admitidas', () => {
    expect(CLIENT_ERROR_COMPONENTS).toEqual([
      'Dashboard',
      'WeeklyView',
      'DayDetail',
      'ChatCoach',
      'PlanBuilder',
      'PlanBuilderV2',
      'CompetitionPlan',
      'CoachWorkspace',
      'Operations',
      'Settings',
      'ImportPDF',
      'Onboarding',
      'SyncService',
    ])
  })

  // Son etiquetas estáticas de integración: nunca un componentStack crudo,
  // que arrastraría nombres de archivo y estructura interna.
  it('no admite una etiqueta libre como componente', () => {
    expect(isClientErrorComponent('Dashboard')).toBe(true)
    expect(isClientErrorComponent('    at PlanBuilderV2Page (index.js:1:1)')).toBe(false)
    expect(isClientErrorComponent('CualquierCosa')).toBe(false)
    expect(isClientErrorComponent(null)).toBe(false)
  })

  it('reconoce las ocho clases de request de la app', () => {
    expect(CLIENT_ERROR_REQUEST_CLASSES).toHaveLength(8)
    expect(isClientErrorRequestClass('chat_general')).toBe(true)
    expect(isClientErrorRequestClass('coach_assistant_message')).toBe(true)
    expect(isClientErrorRequestClass('inventada')).toBe(false)
  })
})
