import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  isKillSwitchActive: vi.fn(() => false),
  assertUsageGate: vi.fn(),
  recordUsageCost: vi.fn(async () => undefined),
  callAnthropicForWeek: vi.fn(async () => ({ /* respuesta mínima válida del proveedor */ })),
  resolveAuthContext: vi.fn(async () => ({ userId: 'user-1', token: 'token-1' })),
  createSupabaseWriter: vi.fn(),
  isEntitlementEnforcementEnabled: vi.fn(() => false),
  resolveEntitlementTier: vi.fn(async () => 'advanced'),
  assertPlanGenerationEntitlement: vi.fn(),
}))

vi.mock('../_shared/usageGate', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/usageGate')>()
  return { ...actual, isKillSwitchActive: handlerMocks.isKillSwitchActive, assertUsageGate: handlerMocks.assertUsageGate, recordUsageCost: handlerMocks.recordUsageCost }
})
vi.mock('../_shared/anthropicCaller', () => ({ callAnthropicForWeek: handlerMocks.callAnthropicForWeek }))
vi.mock('../_shared/planGenerationShared', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/planGenerationShared')>()
  // terminalizeRejectedJob NO va acá — es local a generate-plan-background.ts,
  // no se puede interceptar mockeando este módulo. Se verifica por su efecto
  // observable sobre el writer (putPlan con generationState: 'failed').
  return { ...actual, resolveAuthContext: handlerMocks.resolveAuthContext, createSupabaseWriter: handlerMocks.createSupabaseWriter }
})
vi.mock('../_shared/resolveEntitlement', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    isEntitlementEnforcementEnabled: handlerMocks.isEntitlementEnforcementEnabled,
    resolveEntitlementTier: handlerMocks.resolveEntitlementTier,
    assertPlanGenerationEntitlement: handlerMocks.assertPlanGenerationEntitlement,
  }
})

import { handler } from '../generate-plan-background'
import { buildBackgroundEvent } from './helpers/backgroundPlanTestHarness'

function buildWriterStub(existingPlan: { generationState?: string; generationSummary?: { jobId: string } } | null) {
  return {
    getPlan: vi.fn(async () => existingPlan),
    putPlan: vi.fn(async () => undefined),
    putWeek: vi.fn(async () => undefined),
    putJob: vi.fn(async () => undefined),
  }
}

describe('generate-plan-background — usage gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `vi.clearAllMocks()` limpia `mock.calls`/`mock.results` pero NO
    // deshace un `.mockReturnValue(...)`/`.mockResolvedValue(...)` de un test
    // anterior (verificado: el default `vi.fn(() => false)` de
    // `isKillSwitchActive` queda pisado por `true` de un test previo y
    // sobrevive a `clearAllMocks`). Se restablece el default explícito acá en
    // vez de usar `resetAllMocks()`, que también borraría los defaults
    // async de `recordUsageCost`/`callAnthropicForWeek`/`resolveAuthContext`
    // que varios tests dan por hecho.
    handlerMocks.isKillSwitchActive.mockReturnValue(false)
    // Mismo patrón que `coachTestHarness.ts` (Task 5) para `GEMINI_API_KEY`:
    // `gatedCallLLM` valida `CLAUDE_API_KEY` ANTES del gate, así que sin esto
    // TODOS los tests que esperan llegar a `assertUsageGate`/
    // `callAnthropicForWeek` fallarían con "0 times" — no por un bug de
    // implementación, sino porque `process.env['CLAUDE_API_KEY']` no está
    // seteado en el proceso de test (confirmado: `npx vitest run` no carga
    // `.env.local` en `process.env`). El test de "CLAUDE_API_KEY ausente" lo
    // borra explícitamente después de este `beforeEach`.
    vi.stubEnv('CLAUDE_API_KEY', 'test-claude-key')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('kill switch activo con jobId previo marca el plan failed (efecto observable de terminalizeRejectedJob)', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)
    const writer = buildWriterStub({ generationState: 'generating', generationSummary: { jobId: 'job-existing' } })
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)

    await handler(buildBackgroundEvent({ jobId: 'job-existing' }), {} as never)

    expect(writer.putPlan).toHaveBeenCalledWith(expect.objectContaining({ generationState: 'failed' }))
    expect(handlerMocks.callAnthropicForWeek).not.toHaveBeenCalled()
  })

  it('kill switch activo sin jobId previo no crea ningún writer ni toca ningún plan', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    // Sin jobId no hay nada que limpiar (rejectedJobId es undefined, la rama
    // de terminalizeRejectedJob nunca corre) Y el throw del kill switch corta
    // antes de llegar al createSupabaseWriter principal más abajo — así que
    // no debería invocarse en absoluto.
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()
  })

  it('gate de cuota rechaza el primer attempt antes de llamar al proveedor real, y el rechazo llega traducido a runAsyncPlanGeneration', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    handlerMocks.assertUsageGate.mockRejectedValue(
      Object.assign(new Error('cupo agotado'), { statusCode: 429, errorCode: 'quota_exceeded', detail: { bucketId: 'plan_builder_week', limit: 12, remaining: 0 } }),
    )

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    expect(handlerMocks.callAnthropicForWeek).not.toHaveBeenCalled()

    // No basta con "el proveedor nunca se llamó" — eso también sería cierto
    // si `gatedCallLLM` propagara el `UsageGateHttpError` crudo sin traducir
    // (`translateUsageGateError` roto/revertido a passthrough). Estas dos
    // aserciones sólo pueden pasar si `asyncGenerationLoop.ts` reconoció el
    // error vía `isUsageGateRejection` (instanceof `QuotaExceededError`):
    //
    // 1. `assertUsageGate` se llamó UNA sola vez, sin segundo intento. Un
    //    error crudo (no instanceof) cae al catch genérico de
    //    `generateWeekCoreWithRetry`, que SÍ reintenta hasta
    //    `MAX_WEEK_ATTEMPTS` (2) — así que un rechazo no reconocido habría
    //    vuelto a invocar `gatedCallLLM`, y con él `assertUsageGate`, una
    //    segunda vez.
    expect(handlerMocks.assertUsageGate).toHaveBeenCalledTimes(1)

    // 2. La semana final queda marcada con el mensaje por-causa que SOLO
    //    emite la rama `isUsageGateRejection` de `asyncGenerationLoop.ts`
    //    (`usageGateRejectionMessage`) — un literal distinto tanto del
    //    mensaje del mock ('cupo agotado') como del mensaje propio de
    //    `QuotaExceededError` ('Alcanzaste el cupo diario de esta
    //    función.'). Si la traducción se rompe, ninguna de las dos ramas de
    //    `asyncGenerationLoop.ts` produce este texto exacto.
    const putWeekCalls = writer.putWeek.mock.calls as unknown as Array<[{
      status: string
      generationMeta: { lastError?: string; errorClass?: string }
    }]>
    const finalWeekCall = putWeekCalls[putWeekCalls.length - 1]?.[0]
    expect(finalWeekCall).toMatchObject({
      status: 'error',
      generationMeta: expect.objectContaining({
        lastError: 'Cuota diaria de IA agotada.',
        errorClass: 'quota_exceeded',
      }),
    })
  })

  it('gate aceptado permite la llamada y registra costo después de la respuesta, esperado (no fire-and-forget)', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    handlerMocks.assertUsageGate.mockResolvedValue({ bucketId: 'plan_builder_week', limit: 12, usageDate: '2026-08-16' })
    let costRecordedBeforeReturn = false
    handlerMocks.recordUsageCost.mockImplementation(async () => { costRecordedBeforeReturn = true })
    // Corrección tras verificación local (no en el brief literal): sin
    // `text` con una acción `create_week` válida, `generateWeekCore` no
    // puede aceptar la semana en el primer intento — la marca como fallida y
    // `generateWeekCoreWithRetry` gasta el segundo de `MAX_WEEK_ATTEMPTS`,
    // llamando a `callAnthropicForWeek` dos veces en vez de una. El `text`
    // de abajo es la misma forma que usa `asyncGenerationLoop.test.ts`
    // (`makeRaw`), con `targetDate` alineado a `weekStartDate` del fixture
    // del harness ('2026-06-01').
    handlerMocks.callAnthropicForWeek.mockResolvedValue({
      text: JSON.stringify({
        type: 'create_week',
        targetDate: '2026-06-01',
        reason: 'Semana generada para test',
        weekObjectives: [{ sport: 'squash', goal: 'Technical rhythm' }],
        sessions: [
          {
            date: '2026-06-01',
            timeBlock: 'AM',
            sessionType: 'squash',
            title: 'Squash tecnico',
            durationMin: 60,
            rpe: 6,
            squashDetails: {
              trainingFocus: 'technical',
              sessionMode: 'drill_session',
              sessionKind: 'technical',
              drills: [{ name: 'Drive', durationMin: 12 }],
            },
          },
        ],
      }),
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      promptTokens: 1000,
      completionTokens: 500,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    })

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    expect(handlerMocks.callAnthropicForWeek).toHaveBeenCalledTimes(1)
    expect(handlerMocks.recordUsageCost).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', bucketId: 'plan_builder_week', usageDate: '2026-08-16' }),
    )
    // Si gatedCallLLM hiciera `void recordUsageCost(...)` en vez de `await`,
    // esto podría ser false en un entorno real donde la función corta antes.
    // Acá el mock resuelve síncrono, así que el valor real de esta aserción
    // depende de que el código awaitee — es una señal, no una prueba
    // determinística de la corrección serverless (eso se confirma leyendo el
    // código: no debe haber `void recordUsageCost(...)`).
    expect(costRecordedBeforeReturn).toBe(true)
  })

  it('si el proveedor no reporta tokens, no se registra costo y queda logueada una advertencia', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    handlerMocks.assertUsageGate.mockResolvedValue({ bucketId: 'plan_builder_week', limit: 12, usageDate: '2026-08-16' })
    handlerMocks.callAnthropicForWeek.mockResolvedValue({ model: 'claude-sonnet-4-6' })   // sin promptTokens/completionTokens
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    expect(handlerMocks.recordUsageCost).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no reportó usage'))
  })

  it('CLAUDE_API_KEY ausente no consume cuota (P2, ronda 4)', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    const originalKey = process.env['CLAUDE_API_KEY']
    delete process.env['CLAUDE_API_KEY']

    try {
      await expect(handler(buildBackgroundEvent({ jobId: undefined }), {} as never))
        .resolves.toMatchObject({ statusCode: expect.any(Number) })
      expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
      expect(handlerMocks.callAnthropicForWeek).not.toHaveBeenCalled()
    } finally {
      if (originalKey !== undefined) process.env['CLAUDE_API_KEY'] = originalKey
    }
  })
})
