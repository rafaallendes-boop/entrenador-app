import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SyncNowCard from './SyncNowCard'
import { formatLastSync } from './syncNowFormat'

function render(props: Partial<React.ComponentProps<typeof SyncNowCard>> = {}) {
  return renderToStaticMarkup(
    <SyncNowCard
      status="idle"
      lastSyncAt={null}
      pendingOps={0}
      syncing={false}
      onSync={() => {}}
      {...props}
    />,
  )
}

describe('SyncNowCard', () => {
  it('muestra el título y el CTA entendible', () => {
    const html = render()
    expect(html).toContain('Sincronización')
    expect(html).toContain('Sincronizar entrenamientos')
  })

  it('sin sincronización previa muestra "Nunca sincronizado"', () => {
    expect(render({ lastSyncAt: null })).toContain('Nunca sincronizado')
  })

  it('con cambios pendientes muestra el conteo', () => {
    const html = render({ pendingOps: 3, lastSyncAt: Date.now() })
    expect(html).toContain('3 cambios sin sincronizar')
  })

  it('al día (0 pendientes) no muestra conteo de pendientes', () => {
    const html = render({ pendingOps: 0, lastSyncAt: Date.now() })
    expect(html).not.toContain('sin sincronizar')
    expect(html).toContain('Al día')
  })

  it('mientras sincroniza el botón queda deshabilitado y con label de progreso', () => {
    const html = render({ syncing: true })
    expect(html).toContain('Sincronizando')
    expect(html).toContain('disabled')
  })
})

describe('formatLastSync', () => {
  it('null → "Nunca sincronizado"', () => {
    expect(formatLastSync(null)).toBe('Nunca sincronizado')
  })

  it('reciente → "recién"', () => {
    expect(formatLastSync(Date.now() - 5_000)).toBe('recién')
  })

  it('minutos y horas', () => {
    expect(formatLastSync(Date.now() - 3 * 60_000)).toBe('hace 3 min')
    expect(formatLastSync(Date.now() - 2 * 3_600_000)).toBe('hace 2 h')
  })
})
