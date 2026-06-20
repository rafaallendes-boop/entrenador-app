import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SyncStatusBadge from './SyncStatusBadge'

describe('SyncStatusBadge in production', () => {
  const originalEnv = { ...import.meta.env }

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('renders nothing when synced ok in prod', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: undefined })

    const html = renderToStaticMarkup(<SyncStatusBadge status="idle" error={null} pendingOps={0} />)

    expect(html).toBe('')
  })

  it('does not leak "Sincronizando" or "pendientes" in prod', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: undefined })

    const syncing = renderToStaticMarkup(
      <SyncStatusBadge status="syncing" error={null} pendingOps={3} syncAttemptInFlight />,
    )

    expect(syncing).not.toContain('Sincronizando')
    expect(syncing).not.toContain('pendiente')
  })

  it('shows a calm offline message in prod', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: undefined })

    const html = renderToStaticMarkup(<SyncStatusBadge status="offline" error={null} pendingOps={2} />)

    expect(html).toContain('Sin conexión')
    expect(html).not.toContain('pendiente')
  })

  it('keeps the full technical badge in dev', () => {
    Object.assign(import.meta.env, { PROD: false, VITE_DEV_TOOLS: 'true' })

    const html = renderToStaticMarkup(<SyncStatusBadge status="syncing" error={null} />)

    expect(html).toContain('Sincronizando')
  })
})
