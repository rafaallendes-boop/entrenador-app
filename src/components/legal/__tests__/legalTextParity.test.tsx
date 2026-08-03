// @vitest-environment jsdom

import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import HealthDisclaimerPage from '../../../pages/HealthDisclaimerPage'
import PrivacyPage from '../../../pages/PrivacyPage'
import TermsPage from '../../../pages/TermsPage'
import WhoopDisclaimerPage from '../../../pages/WhoopDisclaimerPage'

/**
 * Paridad de la migración TSX → artefacto de datos (spec §11). Congela que
 * mover la forma no cambió una coma del contenido. Se genera ANTES de migrar.
 *
 * `textContent` solo no alcanza: un enlace migrado con el `href` equivocado o un
 * `<strong>` perdido darían el mismo texto plano. Se captura estructura
 * semántica: etiqueta, énfasis y destino.
 */
function renderedShape(ui: ReactElement): string {
  const { container } = render(<MemoryRouter>{ui}</MemoryRouter>)
  const lines: string[] = []
  container.querySelectorAll('h1, h2, h3, p, li').forEach((node) => {
    const parts: string[] = [`<${node.tagName.toLowerCase()}>`]
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) parts.push(`text:${text}`)
        return
      }
      const el = child as HTMLElement
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (el.tagName === 'A') parts.push(`link[${el.getAttribute('href')}]:${text}`)
      else if (el.tagName === 'STRONG') parts.push(`strong:${text}`)
      else if (text) parts.push(`text:${text}`)
    })
    lines.push(parts.join(' | '))
  })
  return lines.join('\n')
}

describe('paridad del texto legal migrado', () => {
  it('términos renderiza exactamente el mismo texto que antes de migrar', async () => {
    await expect(`${renderedShape(<TermsPage />)}\n`)
      .toMatchFileSnapshot('./__snapshots__/legalTextParity.terms.txt')
  })

  it('privacidad renderiza exactamente el mismo texto que antes de migrar', async () => {
    await expect(`${renderedShape(<PrivacyPage />)}\n`)
      .toMatchFileSnapshot('./__snapshots__/legalTextParity.privacy.txt')
  })

  it('salud renderiza exactamente el mismo texto que antes de migrar', async () => {
    await expect(`${renderedShape(<HealthDisclaimerPage />)}\n`)
      .toMatchFileSnapshot('./__snapshots__/legalTextParity.health.txt')
  })

  it('Whoop renderiza exactamente el mismo texto que antes de migrar', async () => {
    await expect(`${renderedShape(<WhoopDisclaimerPage />)}\n`)
      .toMatchFileSnapshot('./__snapshots__/legalTextParity.whoop.txt')
  })
})
