import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import { WeekCreatorEngine } from '../WeekCreatorEngine'
import { db } from '../../../db/db'
import { useAIDebugStore } from '../../../store/useAIDebugStore'

/**
 * Endurecimiento del fallback determinista (spec 2026-08-03).
 *
 * `buildDeterministicWeekCreatorResponse` corre fuera del `try/catch` del loop
 * de reintentos, y construye fuerza vía `getStrengthExerciseIdentityById`, que
 * lanza si el `id` no existe. Sin guarda, ese throw: pierde la semana
 * degradada, filtra el string interno al chat vía `formatError`, y deja el
 * request de `useAIDebugStore` en vuelo para siempre.
 *
 * Estos tests fijan que el throw salga por el camino ya instrumentado que la
 * rama de validación estrena (`failRequest` + flush + mensaje en español con
 * código de soporte), bajo su propio `errorCode`.
 */

const mockProviderCall = vi.hoisted(() => vi.fn())
const identityOverride = vi.hoisted(() => ({ failingId: null as string | null }))
const validatorOverride = vi.hoisted(() => ({ rejectFallback: false }))

vi.mock('../../ai/providerResolver', () => ({
  getActiveProvider: () => ({ name: 'mock', call: mockProviderCall }),
  getProviderForRequestClass: () => ({ name: 'mock', call: mockProviderCall }),
}))

// Mock quirúrgico: solo el `id` bajo prueba lanza. El resto del catálogo
// resuelve de verdad, así el fallback llega intacto hasta esa fila y el resto
// de los productores deterministas no se ven afectados.
vi.mock('../../training/exerciseLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../training/exerciseLibrary')>()
  return {
    ...actual,
    getStrengthExerciseIdentityById: (id: string) => {
      if (identityOverride.failingId && id === identityOverride.failingId) {
        throw new Error(`Ejercicio de fuerza inexistente: ${id}`)
      }
      return actual.getStrengthExerciseIdentityById(id)
    },
  }
})

// Rechaza solo la validación de la semana ya construida por el fallback, que
// se identifica por el `model` que le estampa `buildDeterministicWeekCreatorResponse`.
// Los intentos del proveedor siguen validando de verdad.
vi.mock('../validateWeekCreatorResponse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../validateWeekCreatorResponse')>()
  return {
    ...actual,
    validateWeekCreatorResponse: (input: Parameters<typeof actual.validateWeekCreatorResponse>[0]) => {
      if (validatorOverride.rejectFallback && input.response.model === 'local-week-fallback') {
        return {
          ok: false as const,
          code: 'missing_create_week' as const,
          error: 'Rechazo inducido de la semana del fallback.',
        }
      }
      return actual.validateWeekCreatorResponse(input)
    },
  }
})

/** `id` presente en el fallback local: lo cubre `strengthCopyProducerIdentity`. */
const FALLBACK_STRENGTH_ID = 'goblet_squat'
const RAW_CAUSE = `Ejercicio de fuerza inexistente: ${FALLBACK_STRENGTH_ID}`

function makeProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: Date.now(),
    sportContext: {
      enabledSports: ['squash', 'strength'],
      primarySport: 'squash',
    },
    planWizardConfig: {
      goalEventId: 'goal-1',
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      sessionsPerWeek: 6,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['strength'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }
}

function makeContext(): ChatContext {
  return {
    athleteProfile: makeProfile(),
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
  }
}

/** Respuesta sin acciones: agota los intentos y fuerza el fallback local. */
function stubProviderWithoutActions(): void {
  mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
    text: 'Puedo armar una semana, pero no incluyo acciones.',
    provider: 'gemini',
    model: 'gemini-flash',
    traceId: request.traceId,
    requestClass: request.requestClass,
  }))
}

function sendWeekCreate() {
  return WeekCreatorEngine.sendWeekCreate(
    'Créame una semana de entrenamiento para la próxima semana',
    makeContext(),
    { surface: 'chat', targetWeekStart: '2026-05-04' },
  )
}

describe('fallback del Week Creator cuando la construcción lanza', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    mockProviderCall.mockReset()
    identityOverride.failingId = null
    validatorOverride.rejectFallback = false
    useAIDebugStore.getState().clear()
    await db.aiRequestLogs.clear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    identityOverride.failingId = null
    validatorOverride.rejectFallback = false
  })

  it('no filtra la causa cruda al caller: expone el mensaje en español con código de soporte', async () => {
    stubProviderWithoutActions()
    identityOverride.failingId = FALLBACK_STRENGTH_ID

    await expect(sendWeekCreate()).rejects.toThrow(
      /^No pude armar una semana válida esta vez\. Revisa tu configuración y vuelve a intentarlo\. Código de soporte: week_creator-[0-9a-f-]+\.$/,
    )
  })

  it('el mensaje al caller no contiene el texto interno del catálogo', async () => {
    stubProviderWithoutActions()
    identityOverride.failingId = FALLBACK_STRENGTH_ID

    const error = await sendWeekCreate().catch((e: unknown) => e as Error)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain(RAW_CAUSE)
    expect(error.message).not.toContain('Ejercicio de fuerza inexistente')
  })

  it('el código de soporte del mensaje apunta a la fila de telemetría del fallback', async () => {
    stubProviderWithoutActions()
    identityOverride.failingId = FALLBACK_STRENGTH_ID

    const error = await sendWeekCreate().catch((e: unknown) => e as Error)
    const supportCode = /Código de soporte: (\S+)\./.exec(error.message)?.[1]

    const failed = useAIDebugStore.getState().requests
      .find((request) => request.errorCode === 'fallback_build_failed')

    expect(failed).toBeDefined()
    expect(supportCode).toBe(failed!.traceId)
  })

  it('registra la causa cruda en console.warn para el operador', async () => {
    stubProviderWithoutActions()
    identityOverride.failingId = FALLBACK_STRENGTH_ID

    await sendWeekCreate().catch(() => undefined)

    const warned = warnSpy.mock.calls.some((call) => JSON.stringify(call).includes(RAW_CAUSE))
    expect(warned).toBe(true)
  })

  it('registra la causa cruda en los warnings de telemetría, no solo en consola', async () => {
    stubProviderWithoutActions()
    identityOverride.failingId = FALLBACK_STRENGTH_ID

    await sendWeekCreate().catch(() => undefined)

    const failed = useAIDebugStore.getState().requests
      .find((request) => request.errorCode === 'fallback_build_failed')

    expect(failed).toBeDefined()
    expect(failed!.warnings?.some((warning) => warning.includes(RAW_CAUSE))).toBe(true)
  })

  it('no deja el request del fallback en vuelo', async () => {
    stubProviderWithoutActions()
    identityOverride.failingId = FALLBACK_STRENGTH_ID

    await sendWeekCreate().catch(() => undefined)

    const inFlight = useAIDebugStore.getState().requests
      .filter((request) => request.status === 'started' || request.status === 'streaming')

    expect(inFlight).toEqual([])
  })
})

describe('fallback del Week Creator cuando la semana construida no valida', () => {
  beforeEach(async () => {
    mockProviderCall.mockReset()
    identityOverride.failingId = null
    validatorOverride.rejectFallback = false
    useAIDebugStore.getState().clear()
    await db.aiRequestLogs.clear()
  })

  afterEach(() => {
    validatorOverride.rejectFallback = false
  })

  // Espejo del caso de build: el código de soporte visible tiene que apuntar a
  // la fila que registra el fallo final, no al trace del fallo del proveedor.
  it('el código de soporte del mensaje apunta a la fila de telemetría del fallback', async () => {
    stubProviderWithoutActions()
    validatorOverride.rejectFallback = true

    const error = await sendWeekCreate().catch((e: unknown) => e as Error)
    const supportCode = /Código de soporte: (\S+)\./.exec(error.message)?.[1]

    const failed = useAIDebugStore.getState().requests
      .find((request) => request.errorCode === 'fallback_invalid')

    expect(failed).toBeDefined()
    expect(supportCode).toBe(failed!.traceId)
  })

  it('conserva el trace del fallo del proveedor en telemetría para correlación', async () => {
    stubProviderWithoutActions()
    validatorOverride.rejectFallback = true

    await sendWeekCreate().catch(() => undefined)

    const requests = useAIDebugStore.getState().requests
    const failed = requests.find((request) => request.errorCode === 'fallback_invalid')
    const providerAttempt = requests.find((request) => request.traceId !== failed?.traceId)

    expect(failed).toBeDefined()
    expect(providerAttempt).toBeDefined()
    expect(failed!.warnings?.some((warning) => warning.includes(providerAttempt!.traceId))).toBe(true)
  })

  it('no deja el request del fallback en vuelo', async () => {
    stubProviderWithoutActions()
    validatorOverride.rejectFallback = true

    await sendWeekCreate().catch(() => undefined)

    const inFlight = useAIDebugStore.getState().requests
      .filter((request) => request.status === 'started' || request.status === 'streaming')

    expect(inFlight).toEqual([])
  })
})

describe('regresión: el fallback sano no cambia de comportamiento', () => {
  beforeEach(async () => {
    mockProviderCall.mockReset()
    identityOverride.failingId = null
    validatorOverride.rejectFallback = false
    useAIDebugStore.getState().clear()
    await db.aiRequestLogs.clear()
  })

  it('sigue devolviendo una semana degradada y no registra fallback_build_failed', async () => {
    stubProviderWithoutActions()

    const response = await sendWeekCreate()

    expect(response.fallbackUsed).toBe(true)
    expect(response.actions?.[0].sessions.length).toBeGreaterThan(0)

    const buildFailures = useAIDebugStore.getState().requests
      .filter((request) => request.errorCode === 'fallback_build_failed')
    expect(buildFailures).toEqual([])
  })
})
