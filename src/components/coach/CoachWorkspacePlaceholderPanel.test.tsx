import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachWorkspacePlaceholderPanel from './CoachWorkspacePlaceholderPanel'

describe('CoachWorkspacePlaceholderPanel', () => {
  it('renders the given title and description', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspacePlaceholderPanel
        title="Biblioteca"
        description="Vas a poder guardar tus ejercicios y plantillas favoritas para reutilizarlos entre atletas."
      />,
    )
    expect(html).toContain('Biblioteca')
    expect(html).toContain('Vas a poder guardar tus ejercicios y plantillas favoritas para reutilizarlos entre atletas.')
  })
})
