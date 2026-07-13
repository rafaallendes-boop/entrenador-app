import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachRosterPanel from './CoachRosterPanel'
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

const ROSTER: Athlete[] = [
  { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
  { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
]

function render(status: RosterStatus, athletes: Athlete[] = [], pendingAction: PendingAthleteAction | null = null) {
  return renderToStaticMarkup(
    <CoachRosterPanel
      athletes={athletes}
      status={status}
      selfId="ath_user-1"
      activeAthleteId="ath_user-1"
      pendingAction={pendingAction}
      onRetry={vi.fn()}
      onCreateAthlete={vi.fn()}
      onTrainAs={vi.fn()}
    />,
  )
}

describe('CoachRosterPanel', () => {
  it('loading: muestra estado de carga', () => {
    const html = render('loading')
    expect(html).toContain('Cargando tus atletas')
  })

  it('error: muestra mensaje y boton de reintentar', () => {
    const html = render('error')
    expect(html).toContain('No pudimos cargar tu roster')
    expect(html).toContain('Reintentar')
  })

  it('con solo self: card "Tú" activa y CTA de crear dentro de un form, sin boton de switch', () => {
    const html = render('ready', [ROSTER[0]])
    expect(html).toContain('Tú')
    expect(html).toContain('Entrenando ahora')
    expect(html).toContain('<form')
    expect(html).toContain('Crear atleta')
    expect(html).not.toContain('Entrenar como este atleta')
  })

  it('con gestionado en el roster: card con nombre real y boton de switch', () => {
    const html = render('ready', ROSTER)
    expect(html).toContain('Cliente 1')
    expect(html).toContain('Entrenar como este atleta')
  })

  it('roster vacio: mensaje explicativo antes del CTA de crear', () => {
    const html = render('ready', [])
    expect(html).toContain('Aún no tienes atletas. Crea el primero.')
  })

  it('accion trainAs pendiente: relabela el boton acted-on y bloquea el CTA de crear', () => {
    const html = render('ready', ROSTER, { athleteId: 'ath_m_abc', kind: 'trainAs' })
    expect(html).toContain('Cambiando atleta…')
    expect(html).not.toContain('Entrenar como este atleta')
    // El CTA de crear tambien dispara un switch: no puede correr en paralelo.
    const createCta = html.match(/<button[^>]*>\s*<svg[^>]*>.*?<\/svg>\s*Crear atleta/s)?.[0] ?? html
    expect(createCta).toContain('disabled')
  })

  it('accion pendiente en otro atleta: igual deshabilita este switch (serializacion global)', () => {
    const html = render('ready', ROSTER, { athleteId: 'ath_user-1', kind: 'week' })
    const managedRow = html.slice(html.indexOf('Cliente 1'))
    expect(managedRow).toContain('Entrenar como este atleta')
    expect(managedRow).toContain('disabled')
  })

  it('creacion pendiente: bloquea los switches (crear tambien activa)', () => {
    const html = render('ready', ROSTER, { kind: 'create', athleteId: null })
    const managedRow = html.slice(html.indexOf('Cliente 1'))
    expect(managedRow).toContain('disabled')
  })
})
