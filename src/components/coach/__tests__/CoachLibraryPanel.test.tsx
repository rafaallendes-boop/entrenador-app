// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  syncDetails: {
    lastSuccessfulSyncAt: null as number | null,
    lastErrorAt: null as number | null,
    lastErrorEntity: null as string | null,
    pendingTables: [] as string[],
  },
}))

vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    syncDetails: mocks.syncDetails,
  }),
}))
vi.mock('../../../services/athlete/sessionTemplates', () => ({
  listSessionTemplates: mocks.list,
  createSessionTemplate: mocks.create,
  updateSessionTemplate: mocks.update,
  softDeleteSessionTemplate: mocks.remove,
  SessionTemplateGoneError: class SessionTemplateGoneError extends Error {},
}))

import CoachLibraryPanel from '../CoachLibraryPanel'
import { SessionTemplateGoneError } from '../../../services/athlete/sessionTemplates'

const supported = {
  id: 'supported', name: 'Volea', kind: 'session', payloadVersion: 1,
  payload: { type: 'squash', timeBlock: 'AM', title: 'Volea', durationMin: 60 },
  createdAt: 1, updatedAt: 2,
} as const

describe('CoachLibraryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([])
    mocks.remove.mockResolvedValue(undefined)
    mocks.create.mockResolvedValue(undefined)
    mocks.update.mockResolvedValue(undefined)
    mocks.syncDetails.lastSuccessfulSyncAt = null
    mocks.syncDetails.lastErrorAt = null
    mocks.syncDetails.lastErrorEntity = null
    mocks.syncDetails.pendingTables = []
  })
  afterEach(cleanup)

  it('muestra el empty state y mantiene el CTA de creación', async () => {
    render(<CoachLibraryPanel />)
    expect(await screen.findByText(/Todavía no tienes plantillas/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nueva plantilla' })).toBeTruthy()
  })

  it('lista vivas, oculta tombstones y marca formatos incompatibles', async () => {
    mocks.list.mockResolvedValueOnce([
      supported,
      { ...supported, id: 'deleted', name: 'Borrada', deletedAt: 3, updatedAt: 3 },
      {
        id: 'future', name: 'Futura', kind: 'week', payloadVersion: 2,
        payload: { raw: true }, createdAt: 1, updatedAt: 4,
      },
    ])
    render(<CoachLibraryPanel />)

    expect(await screen.findByText('Volea')).toBeTruthy()
    expect(screen.queryByText('Borrada')).toBeNull()
    expect(screen.getByText('Futura')).toBeTruthy()
    expect(screen.getByText('Formato no compatible')).toBeTruthy()
    const editButtons = screen.getAllByRole('button', { name: 'Editar' }) as HTMLButtonElement[]
    expect(editButtons.map((button) => button.disabled)).toEqual([false, true])
    expect(screen.getAllByRole('button', { name: 'Eliminar' })).toHaveLength(2)
  })

  it('mantiene Dexie utilizable tras un fallo de sync y recarga al próximo sync exitoso', async () => {
    mocks.syncDetails.lastSuccessfulSyncAt = 10
    mocks.syncDetails.lastErrorAt = 20
    mocks.syncDetails.lastErrorEntity = 'session_templates'
    mocks.syncDetails.pendingTables = ['session_templates']
    mocks.list.mockResolvedValue([supported])
    const view = render(<CoachLibraryPanel />)

    expect(await screen.findByText('Volea')).toBeTruthy()
    expect(screen.getByText(/No se pudo actualizar desde el servidor/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Nueva plantilla' }) as HTMLButtonElement).disabled)
      .toBe(false)

    mocks.syncDetails.lastSuccessfulSyncAt = 30
    mocks.syncDetails.lastErrorAt = null
    mocks.syncDetails.lastErrorEntity = null
    mocks.syncDetails.pendingTables = []
    view.rerender(<CoachLibraryPanel />)
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/No se pudo actualizar desde el servidor/)).toBeNull()
  })

  it('no atribuye a Biblioteca un fallo de sincronización de otra tabla', async () => {
    mocks.syncDetails.lastSuccessfulSyncAt = 10
    mocks.syncDetails.lastErrorAt = 20
    mocks.syncDetails.lastErrorEntity = 'training_plans'
    mocks.syncDetails.pendingTables = ['training_plans']
    mocks.list.mockResolvedValue([supported])

    render(<CoachLibraryPanel />)

    expect(await screen.findByText('Volea')).toBeTruthy()
    expect(screen.queryByText(/No se pudo actualizar desde el servidor/)).toBeNull()
  })

  it('una plantilla incompatible no se edita pero sí se elimina con guard doble', async () => {
    mocks.list
      .mockResolvedValueOnce([{
        id: 'future', name: 'Futura', kind: 'week', payloadVersion: 2, payload: { raw: true },
        createdAt: 1, updatedAt: 2,
      }])
      .mockResolvedValueOnce([])
    let release!: () => void
    mocks.remove.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    render(<CoachLibraryPanel />)
    expect(await screen.findByText('Formato no compatible')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(screen.getByText('Las sesiones ya asignadas a tus atletas no se modifican.')).toBeTruthy()
    const confirm = screen.getAllByRole('button', { name: 'Eliminar' }).at(-1)!
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(mocks.remove).toHaveBeenCalledOnce()
    release()
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
  })

  it('crea una plantilla desde el editor y recarga la lista', async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([supported])
    render(<CoachLibraryPanel />)
    await screen.findByText(/Todavía no tienes plantillas/)
    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Crear plantilla' }))
    expect(mocks.create).toHaveBeenCalledWith('Sesion de squash', expect.objectContaining({
      type: 'squash', title: 'Sesion de squash',
    }))
    expect(await screen.findByText('Volea')).toBeTruthy()
  })

  it('editar conserva la versión abierta para resolver cambios concurrentes al guardar', async () => {
    mocks.list.mockResolvedValueOnce([supported]).mockResolvedValueOnce([supported])
    render(<CoachLibraryPanel />)
    await screen.findByText('Volea')
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '75' } })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(mocks.update).toHaveBeenCalledWith(
      supported.id,
      supported,
      expect.objectContaining({ title: 'Volea', durationMin: 75 }),
      expect.any(Map),
      supported.name,
    )
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('GoneError cierra el editor, recarga y preserva el mensaje', async () => {
    mocks.list.mockResolvedValueOnce([supported]).mockResolvedValueOnce([])
    mocks.update.mockRejectedValueOnce(new SessionTemplateGoneError('Esta plantilla ya no está disponible.'))
    render(<CoachLibraryPanel />)
    await screen.findByText('Volea')
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Esta plantilla ya no está disponible.')
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull()
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('bloquea doble submit y el backdrop mientras el editor está guardando', async () => {
    let release!: () => void
    mocks.create.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    render(<CoachLibraryPanel />)
    await screen.findByText(/Todavía no tienes plantillas/)
    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }))
    const submit = screen.getByRole('button', { name: 'Crear plantilla' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(mocks.create).toHaveBeenCalledOnce()
    const backdrop = screen.getByRole('button', { name: 'Cerrar editor de plantilla' })
    expect((backdrop as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(backdrop)
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeTruthy()
    release()
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cerrar editor de plantilla' })).toBeNull())
  })
})
