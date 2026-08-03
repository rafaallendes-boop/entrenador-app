// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as flag from '../../../services/legal/consentFlag'
import * as service from '../../../services/legal/consentService'
import ConsentGate from '../ConsentGate'

const { authMock } = vi.hoisted(() => ({ authMock: { userId: 'user-1' } }))

vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: authMock.userId } }),
}))
vi.mock('../ConsentAccountActions', () => ({
  default: () => <div>acciones de cuenta disponibles</div>,
}))

describe('ConsentGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    authMock.userId = 'user-1'
    vi.spyOn(flag, 'isConsentEnforcementEnabled').mockReturnValue(true)
    vi.spyOn(service, 'hasAnyPreviousAcceptance').mockResolvedValue(false)
  })

  afterEach(() => cleanup())

  it('con la bandera apagada conserva la app y no consulta el servicio', () => {
    vi.spyOn(flag, 'isConsentEnforcementEnabled').mockReturnValue(false)
    const missing = vi.spyOn(service, 'getMissingConsents')
    render(<ConsentGate><p>app</p></ConsentGate>)
    expect(screen.getByText('app')).toBeTruthy()
    expect(missing).not.toHaveBeenCalled()
  })

  it('abre desde el espejo cuando no falta nada', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue([])
    render(<ConsentGate><p>app</p></ConsentGate>)
    expect(await screen.findByText('app')).toBeTruthy()
  })

  it('hidrata antes de ofrecer aceptación', async () => {
    vi.spyOn(service, 'getMissingConsents')
      .mockResolvedValueOnce(['terms'])
      .mockResolvedValueOnce([])
    const hydrate = vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: true })
    render(<ConsentGate><p>app</p></ConsentGate>)
    expect(await screen.findByText('app')).toBeTruthy()
    expect(hydrate).toHaveBeenCalledWith('user-1')
  })

  it('si no puede verificar ofrece reintento y no aceptación', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue(['terms'])
    vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: false })
    render(<ConsentGate><p>app</p></ConsentGate>)
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /acepto/i })).toBeNull()
    expect(screen.getByText('acciones de cuenta disponibles')).toBeTruthy()
  })

  it('explica la re-aceptación de una versión anterior', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue(['privacy'])
    vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: true })
    vi.spyOn(service, 'hasAnyPreviousAcceptance').mockResolvedValue(true)
    render(<ConsentGate><p>app</p></ConsentGate>)
    expect(await screen.findByText(/actualizamos nuestros documentos/i)).toBeTruthy()
    expect(screen.getByText('acciones de cuenta disponibles')).toBeTruthy()
  })

  it('mantiene las acciones de cuenta disponibles mientras verifica', () => {
    vi.spyOn(service, 'getMissingConsents').mockReturnValue(new Promise(() => undefined))
    render(<ConsentGate><p>app</p></ConsentGate>)

    expect(screen.getByText('Verificando tus consentimientos')).toBeTruthy()
    expect(screen.getByText('acciones de cuenta disponibles')).toBeTruthy()
  })

  it('una evaluación vieja no puede pisar la cuenta nueva', async () => {
    let resolveOld!: (value: ('terms')[]) => void
    const oldResult = new Promise<('terms')[]>((resolve) => { resolveOld = resolve })
    vi.spyOn(service, 'getMissingConsents').mockImplementation((userId) => (
      userId === 'user-1' ? oldResult : Promise.resolve([])
    ))

    const { rerender } = render(<ConsentGate><p>app</p></ConsentGate>)
    authMock.userId = 'user-2'
    rerender(<ConsentGate><p>app</p></ConsentGate>)
    expect(await screen.findByText('app')).toBeTruthy()

    resolveOld(['terms'])
    await waitFor(() => expect(screen.getByText('app')).toBeTruthy())
  })
})
