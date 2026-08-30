// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterTriage } from '../../services/athlete/loadRosterTriage'
import type { DraftFailure, DraftResult } from '../../services/coach/requestAssistantDraft'
import CoachAssistantPanel from './CoachAssistantPanel'
import { isBlockingFailure } from './draftFailurePolicy'

const TRIAGE: RosterTriage = {
  computedAt: Date.UTC(2026, 7, 29, 14, 30),
  selfAthleteId: 'ath_self',
  durationMs: 42,
  athleteCount: 4,
  failedAthleteCount: 0,
  athletes: [
    {
      athleteId: 'ath_a',
      insufficientData: false,
      signals: [
        { kind: 'low-adherence', adherencePct: 40 },
        { kind: 'pain', days: 2 },
      ],
    },
    { athleteId: 'ath_nuevo', insufficientData: true, signals: [] },
    { athleteId: 'ath_ok', insufficientData: false, signals: [] },
    {
      athleteId: 'ath_self',
      insufficientData: true,
      signals: [{ kind: 'no-check-in', days: 5 }],
    },
  ],
}

const NAMES = { ath_a: 'Ana', ath_nuevo: 'Nuevo', ath_ok: 'Ok', ath_self: 'Yo' }

function renderPanel(overrides: Partial<React.ComponentProps<typeof CoachAssistantPanel>> = {}) {
  return render(
    <CoachAssistantPanel
      triage={TRIAGE}
      loading={false}
      selfAthleteId="ath_self"
      athleteNames={NAMES}
      syncLabel="Sincronizado hace 2 min"
      onRefresh={vi.fn()}
      onOpenWeek={vi.fn()}
      onDraft={vi.fn(async (): Promise<DraftResult> => ({ ok: true, body: 'borrador' }))}
      {...overrides}
    />,
  )
}

afterEach(cleanup)

describe('CoachAssistantPanel', () => {
  it('separa con-señales, sin-datos y al-día sin colapsar sin-datos', () => {
    renderPanel()

    const signals = screen.getByTestId('group-con-senales')
    const insufficient = screen.getByTestId('group-sin-datos')
    const upToDate = screen.getByTestId('group-al-dia')
    expect(signals.textContent).toContain('Ana')
    expect(signals.textContent).toContain('Tú')
    expect(insufficient.textContent).toContain('Nuevo')
    expect(insufficient.getAttribute('data-collapsed')).toBe('false')
    expect(upToDate.textContent).toContain('Ok')
    expect(upToDate.getAttribute('data-collapsed')).toBe('true')
    expect((upToDate as HTMLDetailsElement).open).toBe(false)
  })

  it('mantiene insufficient-data junto a una señal posterior', () => {
    renderPanel()

    const signalsGroup = screen.getByTestId('group-con-senales')
    expect(signalsGroup.textContent).toContain('Tú')
    expect(signalsGroup.textContent).toContain('Sin datos suficientes')
    expect(signalsGroup.textContent).toContain('Sin check-in')
  })

  it('ordena las señales con dolor primero', () => {
    renderPanel()

    const chips = screen.getByTestId('signals-ath_a').textContent ?? ''
    expect(chips.indexOf('Dolor')).toBeLessThan(chips.indexOf('Adherencia'))
  })

  it('no ofrece redactar cuando el único estado es sin datos', () => {
    renderPanel()
    expect(screen.queryByTestId('draft-ath_nuevo')).toBeNull()
  })

  it('no ofrece redactar para el self aunque tenga señales', () => {
    renderPanel()
    expect(screen.queryByTestId('draft-ath_self')).toBeNull()
  })

  it('identifica el self como Tú aunque su displayName esté ausente', () => {
    const namesWithoutSelf: Record<string, string> = { ...NAMES }
    delete namesWithoutSelf.ath_self
    renderPanel({ athleteNames: namesWithoutSelf })

    expect(screen.getByTestId('group-con-senales').textContent).toContain('Tú')
    expect(screen.getByTestId('group-con-senales').textContent).not.toContain('Atleta')
  })

  it('abre la semana del atleta sin cambiar el contrato de redacción', async () => {
    const onOpenWeek = vi.fn()
    renderPanel({ onOpenWeek })

    await userEvent.click(screen.getByTestId('week-ath_a'))

    expect(onOpenWeek).toHaveBeenCalledOnce()
    expect(onOpenWeek).toHaveBeenCalledWith('ath_a')
  })

  it('muestra cuándo se calculó y el estado de sync sin prometer tiempo real', () => {
    renderPanel()

    const computedAt = screen.getByTestId('computed-at').textContent ?? ''
    expect(computedAt).toContain('Calculado')
    expect(computedAt).toContain('Sincronizado hace 2 min')
    expect(computedAt).toContain('Datos locales')
    expect(document.body.textContent).toContain('Recalcula si acaba de sincronizar')
    expect(document.body.textContent).not.toMatch(/tiempo real/i)
  })

  it('recalcula de forma explícita y refleja el estado de carga', async () => {
    const onRefresh = vi.fn()
    const view = renderPanel({ onRefresh })

    await userEvent.click(screen.getByRole('button', { name: 'Recalcular' }))
    expect(onRefresh).toHaveBeenCalledOnce()

    view.rerender(
      <CoachAssistantPanel
        triage={TRIAGE}
        loading
        selfAthleteId="ath_self"
        athleteNames={NAMES}
        syncLabel="Sincronizado hace 2 min"
        onRefresh={onRefresh}
        onOpenWeek={vi.fn()}
        onDraft={vi.fn(async () => ({ ok: true, body: 'borrador' }))}
      />,
    )
    expect((screen.getByRole('button', { name: 'Recalculando…' }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('copia el mensaje completo, saludo local incluido', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()

    await userEvent.click(screen.getByTestId('draft-ath_a'))
    await vi.waitFor(() => { screen.getByTestId('copy-ath_a') })
    await userEvent.click(screen.getByTestId('copy-ath_a'))

    await vi.waitFor(() => {
      expect(screen.getByTestId('copy-state-ath_a').textContent).toBe('Copiado')
    })
    expect(writeText).toHaveBeenCalledWith('Hola Ana,\nborrador')
  })

  it('sin portapapeles disponible lo dice en vez de fingir que copió', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderPanel()

    await userEvent.click(screen.getByTestId('draft-ath_a'))
    await vi.waitFor(() => { screen.getByTestId('copy-ath_a') })
    await userEvent.click(screen.getByTestId('copy-ath_a'))

    await vi.waitFor(() => {
      expect(screen.getByTestId('copy-state-ath_a').textContent).toMatch(/no pudimos copiar/i)
    })
  })

  it('el borrador es editable y se copia lo editado, no lo generado', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()

    await userEvent.click(screen.getByTestId('draft-ath_a'))
    await vi.waitFor(() => { screen.getByTestId('draft-body-ath_a') })

    const textarea = screen.getByTestId('draft-body-ath_a') as HTMLTextAreaElement
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hola Ana, lo edité yo.')
    await userEvent.click(screen.getByTestId('copy-ath_a'))

    expect(textarea.value).toBe('Hola Ana, lo edité yo.')
    expect(writeText).toHaveBeenCalledWith('Hola Ana, lo edité yo.')
  })

  it('a igual tipo de señal ordena por magnitud antes que por nombre', () => {
    renderPanel({
      triage: {
        ...TRIAGE,
        athletes: [
          { athleteId: 'ath_leve', insufficientData: false, signals: [{ kind: 'pain', days: 2 }] },
          { athleteId: 'ath_grave', insufficientData: false, signals: [{ kind: 'pain', days: 6 }] },
        ],
      },
      athleteNames: { ath_leve: 'Ana', ath_grave: 'Zoe' },
    })

    // Alfabéticamente Ana iría primero; seis días de dolor pesan más.
    const rendered = screen.getByTestId('group-con-senales').textContent ?? ''
    expect(rendered.indexOf('Zoe')).toBeLessThan(rendered.indexOf('Ana'))
  })

  it('un tipo más grave gana aunque su magnitud sea menor', () => {
    renderPanel({
      triage: {
        ...TRIAGE,
        athletes: [
          {
            athleteId: 'ath_muchas',
            insufficientData: false,
            signals: [{ kind: 'overdue-sessions', count: 12, oldestDaysAgo: 14 }],
          },
          { athleteId: 'ath_dolor', insufficientData: false, signals: [{ kind: 'pain', days: 1 }] },
        ],
      },
      athleteNames: { ath_muchas: 'Ana', ath_dolor: 'Zoe' },
    })

    // La magnitud sólo desempata dentro del mismo tipo: el dolor sigue primero.
    const rendered = screen.getByTestId('group-con-senales').textContent ?? ''
    expect(rendered.indexOf('Zoe')).toBeLessThan(rendered.indexOf('Ana'))
  })

  it('muestra el borrador para revisar y copiar sin acción de envío', async () => {
    renderPanel()

    await userEvent.click(screen.getByTestId('draft-ath_a'))

    await vi.waitFor(() => {
      expect(screen.getByTestId('draft-body-ath_a').textContent).toContain('borrador')
    })
    expect(screen.getByTestId('draft-body-ath_a').textContent).toContain('Hola Ana')
    expect(screen.queryByRole('button', { name: /enviar/i })).toBeNull()
  })

  it.each(['quota', 'kill-switch', 'entitlement'] as const)(
    '%s deshabilita el botón y muestra el motivo',
    async (reason) => {
      renderPanel({ onDraft: draftFailure(reason) })

      await userEvent.click(screen.getByTestId('draft-ath_a'))

      await vi.waitFor(() => {
        expect((screen.getByTestId('draft-ath_a') as HTMLButtonElement).disabled).toBe(true)
      })
      expect(screen.getByTestId('draft-error-ath_a').textContent?.trim()).not.toBe('')
      expect(screen.getByTestId('group-con-senales').textContent).toContain('Ana')
    },
  )

  it('un fallo transitorio muestra el motivo pero deja reintentar', async () => {
    // Contrapartida del test de arriba: `unavailable` y `timeout` son fallos
    // que reintentar SÍ puede resolver, así que informan sin deshabilitar.
    renderPanel({ onDraft: draftFailure('unavailable') })

    await userEvent.click(screen.getByTestId('draft-ath_a'))

    await vi.waitFor(() => {
      expect(screen.getByTestId('draft-error-ath_a').textContent?.trim()).not.toBe('')
    })
    expect((screen.getByTestId('draft-ath_a') as HTMLButtonElement).disabled).toBe(false)
  })

  it('un bloqueo de clase deshabilita la redacción para todos los atletas', async () => {
    const triage: RosterTriage = {
      ...TRIAGE,
      athleteCount: TRIAGE.athleteCount + 1,
      athletes: [
        ...TRIAGE.athletes,
        {
          athleteId: 'ath_b',
          insufficientData: false,
          signals: [{ kind: 'pain', days: 1 }],
        },
      ],
    }
    renderPanel({
      triage,
      athleteNames: { ...NAMES, ath_b: 'Bea' },
      onDraft: draftFailure('quota'),
    })

    await userEvent.click(screen.getByTestId('draft-ath_a'))

    await vi.waitFor(() => {
      expect((screen.getByTestId('draft-ath_a') as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByTestId('draft-ath_b') as HTMLButtonElement).disabled).toBe(true)
    })
    expect(screen.getByTestId('draft-global-error').textContent?.trim()).not.toBe('')
  })

  it.each(['timeout', 'network', 'rate-limit', 'invalid-response', 'too-long'] as const)(
    '%s muestra el motivo, preserva el triaje y deja reintentar',
    async (reason) => {
      const onDraft = draftFailure(reason)
      renderPanel({ onDraft })

      await userEvent.click(screen.getByTestId('draft-ath_a'))

      await vi.waitFor(() => {
        expect(screen.getByTestId('draft-error-ath_a').textContent?.trim()).not.toBe('')
      })
      expect((screen.getByTestId('draft-ath_a') as HTMLButtonElement).disabled).toBe(false)
      expect(screen.getByTestId('group-con-senales').textContent).toContain('Ana')

      await userEvent.click(screen.getByTestId('draft-ath_a'))
      expect(onDraft).toHaveBeenCalledTimes(2)
    },
  )

  it('una respuesta inválida no renderiza cuerpo parcial', async () => {
    renderPanel({ onDraft: draftFailure('invalid-response') })

    await userEvent.click(screen.getByTestId('draft-ath_a'))

    await vi.waitFor(() => {
      expect(screen.getByTestId('draft-error-ath_a')).toBeTruthy()
    })
    expect(screen.queryByTestId('draft-body-ath_a')).toBeNull()
  })

  it('recalcular limpia un bloqueo de clase y permite comprobarlo de nuevo', async () => {
    const onRefresh = vi.fn()
    renderPanel({ onRefresh, onDraft: draftFailure('quota') })
    await userEvent.click(screen.getByTestId('draft-ath_a'))
    await vi.waitFor(() => {
      expect((screen.getByTestId('draft-ath_a') as HTMLButtonElement).disabled).toBe(true)
    })

    await userEvent.click(screen.getByRole('button', { name: 'Recalcular' }))

    expect(onRefresh).toHaveBeenCalledOnce()
    expect((screen.getByTestId('draft-ath_a') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByTestId('draft-global-error')).toBeNull()
  })

  it('conserva un borrador pagado cuando cambia computedAt al recalcular', async () => {
    const view = renderPanel()
    await userEvent.click(screen.getByTestId('draft-ath_a'))
    await vi.waitFor(() => expect(screen.getByTestId('draft-body-ath_a')).toBeTruthy())

    view.rerender(
      <CoachAssistantPanel
        triage={{ ...TRIAGE, computedAt: TRIAGE.computedAt + 60_000 }}
        loading={false}
        selfAthleteId="ath_self"
        athleteNames={NAMES}
        syncLabel="Sincronizado ahora"
        onRefresh={vi.fn()}
        onOpenWeek={vi.fn()}
        onDraft={vi.fn(async () => ({ ok: true, body: 'otro' }))}
      />,
    )

    expect(screen.getByTestId('draft-body-ath_a').textContent).toContain('borrador')
  })

  it('publica un borrador que termina después de un recálculo', async () => {
    let resolveDraft: ((result: DraftResult) => void) | undefined
    const onDraft = vi.fn(() => new Promise<DraftResult>((resolve) => {
      resolveDraft = resolve
    }))
    const view = renderPanel({ onDraft })
    await userEvent.click(screen.getByTestId('draft-ath_a'))

    view.rerender(
      <CoachAssistantPanel
        triage={{ ...TRIAGE, computedAt: TRIAGE.computedAt + 60_000 }}
        loading={false}
        selfAthleteId="ath_self"
        athleteNames={NAMES}
        syncLabel="Sincronizado ahora"
        onRefresh={vi.fn()}
        onOpenWeek={vi.fn()}
        onDraft={onDraft}
      />,
    )
    resolveDraft?.({ ok: true, body: 'llegó tarde' })

    await vi.waitFor(() => {
      expect(screen.getByTestId('draft-body-ath_a').textContent).toContain('llegó tarde')
    })
  })

  it('muestra cuando un recálculo falló sin ocultar el snapshot anterior', () => {
    renderPanel({ error: 'No se pudo actualizar el triaje.' })

    expect(screen.getByTestId('triage-error').textContent).toContain('No se pudo actualizar')
    expect(screen.getByTestId('group-con-senales').textContent).toContain('Ana')
    expect(screen.getByTestId('computed-at')).toBeTruthy()
  })

  it('las métricas sólo aparecen con dev tools', () => {
    const view = renderPanel()
    expect(screen.queryByTestId('triage-metrics')).toBeNull()
    view.unmount()

    renderPanel({ devToolsEnabled: true })
    expect(screen.getByTestId('triage-metrics').textContent).toContain('42 ms')
    expect(screen.getByTestId('triage-metrics').textContent).toContain('4 atletas')
  })

  it('un fallo transitorio del gate no deshabilita el asistente de forma permanente', () => {
    // `unavailable` cubre cualquier error no reintentable, incluido el 503 de
    // infraestructura del gate de uso. Bloquear la superficie entera por un
    // hipo de PostgREST es peor que el problema que se quiso resolver: el
    // bloqueo se reserva a rechazos que reintentar NO puede cambiar.
    expect(isBlockingFailure('quota')).toBe(true)
    expect(isBlockingFailure('kill-switch')).toBe(true)
    expect(isBlockingFailure('entitlement')).toBe(true)
    expect(isBlockingFailure('unavailable')).toBe(false)
    expect(isBlockingFailure('timeout')).toBe(false)
  })
})

function draftFailure(reason: DraftFailure) {
  return vi.fn(async (): Promise<DraftResult> => ({ ok: false, reason }))
}
