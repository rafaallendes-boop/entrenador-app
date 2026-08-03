// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  signOut: vi.fn(),
  wipe: vi.fn(),
}))

vi.mock('../../../services/dataExport', () => ({
  downloadAppDataExport: mocks.download,
}))
vi.mock('../../../services/syncService', () => ({
  wipeRemoteAndLocalAppData: mocks.wipe,
}))
vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string }; signOut: typeof mocks.signOut }) => unknown) => selector({
    user: { id: 'user-1' },
    signOut: mocks.signOut,
  }),
}))

import ConsentAccountActions from '../ConsentAccountActions'

describe('ConsentAccountActions', () => {
  beforeEach(() => {
    mocks.download.mockReset().mockResolvedValue('rallyiq-backup.json')
    mocks.signOut.mockReset().mockResolvedValue(undefined)
    mocks.wipe.mockReset().mockResolvedValue({ completed: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'prompt').mockReturnValue('BORRAR')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('permite exportar sin aceptar', async () => {
    render(<ConsentAccountActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Exportar mis datos' }))

    expect(await screen.findByText('Backup exportado: rallyiq-backup.json')).toBeTruthy()
    expect(mocks.download).toHaveBeenCalledOnce()
  })

  it('permite cerrar sesión sin aceptar', async () => {
    render(<ConsentAccountActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce())
  })

  it('permite borrar datos con confirmación explícita', async () => {
    render(<ConsentAccountActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar mis datos' }))

    await waitFor(() => expect(mocks.wipe).toHaveBeenCalledWith('user-1'))
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(window.prompt).toHaveBeenCalledWith('Escribe BORRAR para confirmar.')
    expect(await screen.findByText('Tus datos de la aplicación fueron eliminados.')).toBeTruthy()
  })
})
