import { describe, expect, it } from 'vitest'
import { decideLoadDirective, renderLoadDirective } from '../loadDirectivePolicy'

describe('decideLoadDirective', () => {
  it('reduce con fatiga declarada overloaded, por encima de todo lo demás', () => {
    const decision = decideLoadDirective({ declaredFatigue: 'overloaded', avgActualRpe: 5, rpeSampleCount: 5 })
    expect(decision.verdict).toBe('reduce')
    expect(decision.reason).toContain('fatiga')
  })

  it('reduce con energía baja', () => {
    expect(decideLoadDirective({ latestEnergyLevel: 3 }).verdict).toBe('reduce')
  })

  it('reduce con dolor elevado', () => {
    expect(decideLoadDirective({ latestPainLevel: 7 }).verdict).toBe('reduce')
  })

  it('mantiene con fatiga declarada loaded', () => {
    expect(decideLoadDirective({ declaredFatigue: 'loaded' }).verdict).toBe('hold')
  })

  it('mantiene o baja con RPE real alto y muestra suficiente', () => {
    const decision = decideLoadDirective({ avgActualRpe: 8.4, rpeSampleCount: 4 })
    expect(decision.verdict).toBe('hold')
    expect(decision.reason).toContain('RPE')
  })

  it('ignora RPE alto con muestra insuficiente', () => {
    expect(decideLoadDirective({ avgActualRpe: 9, rpeSampleCount: 2 }).verdict).toBe('no_signal')
  })

  it('mantiene con adherencia baja: no sube carga sobre trabajo no hecho', () => {
    const decision = decideLoadDirective({ adherencePct: 45 })
    expect(decision.verdict).toBe('hold')
    expect(decision.reason).toContain('adherencia')
  })

  it('progresa con atleta fresco y sin alertas', () => {
    expect(decideLoadDirective({ declaredFatigue: 'fresh' }).verdict).toBe('progress')
  })

  it('devuelve no_signal sin ninguna señal', () => {
    expect(decideLoadDirective({}).verdict).toBe('no_signal')
  })

  it('prioriza dolor por encima de atleta fresco', () => {
    expect(decideLoadDirective({ declaredFatigue: 'fresh', latestPainLevel: 8 }).verdict).toBe('reduce')
  })

  it('mantiene con sueño bajo', () => {
    const decision = decideLoadDirective({ avgSleepHours: 5.4 })
    expect(decision.verdict).toBe('hold')
    expect(decision.reason).toContain('sueño')
  })

  it('no lee ningún campo de Whoop', () => {
    const signals = { avgActualRpe: 6, rpeSampleCount: 4 } as Record<string, unknown>
    signals.whoopRecovery = 20
    expect(decideLoadDirective(signals as never).verdict).toBe('no_signal')
  })

  it('el dolor gana sobre la adherencia baja', () => {
    expect(decideLoadDirective({ latestPainLevel: 8, adherencePct: 20 }).verdict).toBe('reduce')
  })
})

describe('renderLoadDirective', () => {
  it('produce una línea accionable en mayúsculas para cada veredicto', () => {
    for (const verdict of ['reduce', 'hold', 'progress'] as const) {
      const text = renderLoadDirective({ verdict, reason: 'motivo de prueba' })
      expect(text).toMatch(/^(REDUCIR|MANTENER|SUBIR)/)
      expect(text).toContain('motivo de prueba')
    }
  })

  it('devuelve cadena vacía para no_signal, para que el llamador omita la línea', () => {
    expect(renderLoadDirective({ verdict: 'no_signal', reason: '' })).toBe('')
  })
})
