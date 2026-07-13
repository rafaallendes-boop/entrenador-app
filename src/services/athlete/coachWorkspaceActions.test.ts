import { describe, expect, it, vi } from 'vitest'
import { createAndActivateAthlete, selectAthleteAndNavigate } from './coachWorkspaceActions'
import type { Athlete } from '../../types'

const ATHLETE: Athlete = {
  id: 'ath_m_1',
  ownerAccountId: 'user-1',
  linkedAccountId: null,
  displayName: 'Cliente 1',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}

describe('selectAthleteAndNavigate', () => {
  it('atleta ya activo: navega directo sin llamar a switchActiveAthlete', async () => {
    const switchActiveAthlete = vi.fn()
    const navigate = vi.fn()
    const result = await selectAthleteAndNavigate({ switchActiveAthlete, navigate }, 'user-1', 'ath_1', 'ath_1', '/week')
    expect(switchActiveAthlete).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/week')
    expect(result).toEqual({ navigated: true, switched: false })
  })

  it('atleta diferente y switch exitoso: cambia y luego navega', async () => {
    const switchActiveAthlete = vi.fn().mockResolvedValue(true)
    const navigate = vi.fn()
    const result = await selectAthleteAndNavigate({ switchActiveAthlete, navigate }, 'user-1', 'ath_2', 'ath_1', '/plans/builder')
    expect(switchActiveAthlete).toHaveBeenCalledWith('user-1', 'ath_2')
    expect(navigate).toHaveBeenCalledWith('/plans/builder')
    expect(result).toEqual({ navigated: true, switched: true })
  })

  it('switch fallido: no navega y reporta el fallo', async () => {
    const switchActiveAthlete = vi.fn().mockResolvedValue(false)
    const navigate = vi.fn()
    const result = await selectAthleteAndNavigate({ switchActiveAthlete, navigate }, 'user-1', 'ath_2', 'ath_1', '/week')
    expect(navigate).not.toHaveBeenCalled()
    expect(result).toEqual({ navigated: false, switched: false })
  })
})

describe('createAndActivateAthlete', () => {
  it('creacion y activacion exitosas', async () => {
    const createManagedAthlete = vi.fn().mockResolvedValue(ATHLETE)
    const switchActiveAthlete = vi.fn().mockResolvedValue(true)
    const result = await createAndActivateAthlete({ createManagedAthlete, switchActiveAthlete }, 'user-1', 'Cliente 1')
    expect(createManagedAthlete).toHaveBeenCalledWith('user-1', 'Cliente 1')
    expect(switchActiveAthlete).toHaveBeenCalledWith('user-1', 'ath_m_1')
    expect(result).toEqual({ athlete: ATHLETE, activated: true })
  })

  it('creacion exitosa pero activacion devuelve false: igual devuelve el atleta creado', async () => {
    const createManagedAthlete = vi.fn().mockResolvedValue(ATHLETE)
    const switchActiveAthlete = vi.fn().mockResolvedValue(false)
    const result = await createAndActivateAthlete({ createManagedAthlete, switchActiveAthlete }, 'user-1', 'Cliente 1')
    expect(result).toEqual({ athlete: ATHLETE, activated: false })
  })

  it('creacion exitosa pero activacion lanza: no pierde el atleta creado', async () => {
    const createManagedAthlete = vi.fn().mockResolvedValue(ATHLETE)
    // Post-Task 2b el rechazo legitimo viene del acceso a Dexie PREVIO al commit.
    const switchActiveAthlete = vi.fn().mockRejectedValue(new Error('Dexie falló antes del commit'))
    const result = await createAndActivateAthlete({ createManagedAthlete, switchActiveAthlete }, 'user-1', 'Cliente 1')
    expect(result).toEqual({ athlete: ATHLETE, activated: false })
  })

  it('creacion fallida: propaga el error sin llamar a switchActiveAthlete', async () => {
    const createManagedAthlete = vi.fn().mockRejectedValue(new Error('El nombre del atleta no puede estar vacío'))
    const switchActiveAthlete = vi.fn()
    await expect(
      createAndActivateAthlete({ createManagedAthlete, switchActiveAthlete }, 'user-1', ''),
    ).rejects.toThrow('no puede estar vacío')
    expect(switchActiveAthlete).not.toHaveBeenCalled()
  })
})
