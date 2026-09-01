// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AthleteProfileEditor from '../AthleteProfileEditor'
import type { AthleteProfile } from '../../../types'

const profile: AthleteProfile = { id: 'athlete-1', updatedAt: 0, name: 'Rafa' }

function renderEditor(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(<AthleteProfileEditor profile={profile} isSaving={false} onSave={onSave} />)
  return onSave
}

/** El campo de nombre vive dentro de una sección colapsable. */
async function openBaseProfile() {
  await userEvent.click(screen.getByRole('button', { name: /Deporte y perfil base/ }))
}

describe('aviso de cambios sin guardar', () => {
  afterEach(() => cleanup())

  // El editor no autoguarda. Durante el smoke de producción un cambio se
  // perdió en silencio porque nada indicaba que faltaba pulsar "Guardar
  // perfil".
  it('no avisa nada mientras el formulario está intacto', () => {
    renderEditor()
    expect(screen.queryByTestId('profile-unsaved-badge')).toBeNull()
  })

  it('avisa en cuanto se edita un campo', async () => {
    renderEditor()
    await openBaseProfile()
    await userEvent.type(screen.getByDisplayValue('Rafa'), 'el')

    expect(screen.getByTestId('profile-unsaved-badge').textContent).toContain('sin guardar')
  })

  it('el aviso desaparece al guardar', async () => {
    const onSave = renderEditor()
    await openBaseProfile()
    await userEvent.type(screen.getByDisplayValue('Rafa'), 'el')
    expect(screen.getByTestId('profile-unsaved-badge')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Guardar perfil/ }))

    expect(onSave).toHaveBeenCalled()
    expect(screen.queryByTestId('profile-unsaved-badge')).toBeNull()
  })

  it('vuelve a avisar si se edita después de guardar', async () => {
    renderEditor()
    await openBaseProfile()
    await userEvent.type(screen.getByDisplayValue('Rafa'), 'el')
    await userEvent.click(screen.getByRole('button', { name: /Guardar perfil/ }))
    expect(screen.queryByTestId('profile-unsaved-badge')).toBeNull()

    await userEvent.type(screen.getByDisplayValue('Rafael'), 'x')
    expect(screen.getByTestId('profile-unsaved-badge')).toBeTruthy()
  })

  it('bloquea cerrar o recargar la pestaña mientras haya cambios sin guardar', async () => {
    renderEditor()
    await openBaseProfile()
    await userEvent.type(screen.getByDisplayValue('Rafa'), 'el')

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('no bloquea la salida cuando no hay cambios pendientes', () => {
    renderEditor()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  // El padre remonta el editor por `key={profile.updatedAt}`. Sin exponer el
  // estado sucio, un pull de sync en segundo plano descartaba en silencio lo
  // que el atleta estaba escribiendo — justo lo que el aviso promete evitar.
  it('reporta el estado sucio hacia afuera para que el padre no lo remonte', async () => {
    const onDirtyChange = vi.fn()
    render(
      <AthleteProfileEditor
        profile={profile}
        isSaving={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDirtyChange={onDirtyChange}
      />,
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    await openBaseProfile()
    await userEvent.type(screen.getByDisplayValue('Rafa'), 'el')

    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('el aviso de salida de página se registra con returnValue para WebKit', async () => {
    renderEditor()
    await openBaseProfile()
    await userEvent.type(screen.getByDisplayValue('Rafa'), 'el')

    // jsdom expone `Event.returnValue` como el booleano legado, así que se
    // observa la escritura en vez del valor final: lo que importa es que el
    // handler la haga, porque WebKit todavía condiciona el diálogo a ella.
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const written: unknown[] = []
    Object.defineProperty(event, 'returnValue', {
      configurable: true,
      get: () => written.at(-1),
      set: (value: unknown) => { written.push(value) },
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(written).toEqual([''])
  })
})
