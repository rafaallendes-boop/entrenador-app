// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AthleteProfileEditor from '../AthleteProfileEditor'
import type { AthleteProfile } from '../../../types'

function makeProfile(
  scheduleProfile: AthleteProfile['scheduleProfile'],
  recoveryProfile?: AthleteProfile['recoveryProfile'],
): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 0,
    name: 'Rafa',
    scheduleProfile,
    recoveryProfile,
  }
}

async function openSchedule() {
  await userEvent.click(screen.getByRole('button', { name: /Disponibilidad semanal/ }))
}

describe('AthleteProfileEditor weekly session target', () => {
  afterEach(() => cleanup())

  it('keeps a saved target when the profile has no available days selected', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <AthleteProfileEditor
        profile={makeProfile({ sessionsPerWeek: 5 })}
        isSaving={false}
        onSave={onSave}
      />,
    )

    await openSchedule()
    // No availability signal, so the ceiling stays open instead of collapsing to 0.
    expect(screen.getByRole('button', { name: '5' })).not.toHaveProperty('disabled', true)
    expect(screen.getByText(/Elige tus días disponibles/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      scheduleProfile: expect.objectContaining({ sessionsPerWeek: 5 }),
    }))
    expect(screen.getByText('✓ Guardado en este dispositivo')).toBeTruthy()
  })

  it('clamps the target to the capacity the days and doubles actually leave open', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <AthleteProfileEditor
        profile={makeProfile({
          availableDays: ['lun', 'mar', 'mié'],
          doubleSessionDays: ['lun'],
          sessionsPerWeek: 8,
        })}
        isSaving={false}
        onSave={onSave}
      />,
    )

    await openSchedule()
    expect(screen.getByText(/Máximo configurable con tus días y dobles: 4/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      scheduleProfile: expect.objectContaining({ sessionsPerWeek: 4 }),
    }))
  })

  it('subtracts days that the free-text constraints rule out', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <AthleteProfileEditor
        profile={makeProfile({
          availableDays: ['lun', 'mar', 'mié'],
          doubleSessionDays: ['lun'],
          sessionsPerWeek: 8,
          constraints: 'lunes no disponible',
        })}
        isSaving={false}
        onSave={onSave}
      />,
    )

    await openSchedule()
    // Monday and its double are gone: only Tuesday and Wednesday remain.
    expect(screen.getByText(/Máximo configurable con tus días y dobles: 2/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      scheduleProfile: expect.objectContaining({ sessionsPerWeek: 2 }),
    }))
  })

  it('shows the read-only constraint feedback below the recovery fields', async () => {
    render(
      <AthleteProfileEditor
        profile={makeProfile(undefined, { currentInjuries: 'dolor lumbar' })}
        isSaving={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Lesiones y restricciones/ }))

    expect(screen.getByText('Entendí: zona lumbar')).toBeTruthy()
  })
})

describe('AthleteProfileEditor performance limiter', () => {
  afterEach(() => cleanup())

  it('saves a declared performance limiter as its own field, outside recovery', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <AthleteProfileEditor
        profile={makeProfile(undefined)}
        isSaving={false}
        onSave={onSave}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Deporte y perfil base/ }))
    await userEvent.type(
      screen.getByPlaceholderText('Ej: recuperación cardíaca entre puntos'),
      'recuperación cardíaca entre puntos',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      performanceLimiter: 'recuperación cardíaca entre puntos',
    }))
    const savedPatch = onSave.mock.calls[0][0]
    expect(savedPatch.recoveryProfile).toBeUndefined()
  })

  it('omits the field when left blank', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <AthleteProfileEditor
        profile={makeProfile(undefined)}
        isSaving={false}
        onSave={onSave}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      performanceLimiter: undefined,
    }))
  })
})

describe('AthleteProfileEditor experiencia en fuerza', () => {
  afterEach(() => cleanup())

  it('guarda la experiencia declarada dentro de strengthProfile', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<AthleteProfileEditor profile={makeProfile(undefined)} isSaving={false} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /Fuerza/ }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Experiencia en fuerza' }), 'advanced')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      strengthProfile: expect.objectContaining({ experienceLevel: 'advanced' }),
    }))
  })
})
