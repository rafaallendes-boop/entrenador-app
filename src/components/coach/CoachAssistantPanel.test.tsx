// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterTriage } from '../../services/athlete/loadRosterTriage'
import type { DraftFailure, DraftResult } from '../../services/coach/requestAssistantDraft'
import CoachAssistantPanel from './CoachAssistantPanel'

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
    expect(signals.textContent).toContain('Yo')
    expect(insufficient.textContent).toContain('Nuevo')
    expect(insufficient.getAttribute('data-collapsed')).toBe('false')
    expect(upToDate.textContent).toContain('Ok')
    expect(upToDate.getAttribute('data-collapsed')).toBe('true')
    expect((upToDate as HTMLDetailsElement).open).toBe(false)
  })

  it('mantiene insufficient-data junto a una señal posterior', () => {
    renderPanel()

    const signalsGroup = screen.getByTestId('group-con-senales')
    expect(signalsGroup.textContent).toContain('Yo')
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

  it.each(['timeout', 'network', 'rate-limit', 'unavailable', 'invalid-response', 'too-long'] as const)(
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
})

function draftFailure(reason: DraftFailure) {
  return vi.fn(async (): Promise<DraftResult> => ({ ok: false, reason }))
}
