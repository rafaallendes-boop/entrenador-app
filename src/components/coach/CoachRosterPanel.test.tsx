import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachRosterPanel from './CoachRosterPanel'
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

const ROSTER: Athlete[] = [
  { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
  { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
]

const CLAIMED: Athlete = {
  id: 'ath_m_claimed', ownerAccountId: 'user-1', linkedAccountId: 'user-9',
  displayName: 'Cliente vinculada', status: 'active', createdAt: 1, updatedAt: 1,
}
const ARCHIVED: Athlete = {
  id: 'ath_m_archived', ownerAccountId: 'user-1', linkedAccountId: null,
  displayName: 'Cliente archivada', status: 'archived', createdAt: 1, updatedAt: 1,
}
const ARCHIVED_CLAIMED: Athlete = {
  id: 'ath_m_archived_claimed', ownerAccountId: 'user-1', linkedAccountId: 'user-8',
  displayName: 'Archivada vinculada', status: 'archived', createdAt: 1, updatedAt: 1,
}

function render(
  status: RosterStatus,
  athletes: Athlete[] = [],
  pendingAction: PendingAthleteAction | null = null,
  archivedAthletes: Athlete[] = [],
  initialDeleteTargetId?: string,
) {
  return renderToStaticMarkup(
    <CoachRosterPanel
      athletes={athletes}
      archivedAthletes={archivedAthletes}
      status={status}
      selfId="ath_user-1"
      activeAthleteId="ath_user-1"
      pendingAction={pendingAction}
      onRetry={vi.fn()}
      onCreateAthlete={vi.fn()}
      onTrainAs={vi.fn()}
      onArchive={vi.fn()}
      onRestore={vi.fn()}
      onDelete={vi.fn()}
      initialDeleteTargetId={initialDeleteTargetId}
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

  it('muestra Archivar solo en gestionados no reclamados', () => {
    const html = render('ready', [...ROSTER, CLAIMED])
    expect((html.match(/>Archivar</g) ?? [])).toHaveLength(1)
    expect(html.slice(html.indexOf('Cliente vinculada'))).not.toMatch(/>Archivar</)
  })

  it('muestra Archivados con acciones solo para atletas no vinculados', () => {
    const html = render('ready', ROSTER, null, [ARCHIVED, ARCHIVED_CLAIMED])
    expect(html).toContain('Archivados (2)')
    expect((html.match(/>Restaurar</g) ?? [])).toHaveLength(1)
    expect((html.match(/>Eliminar definitivamente</g) ?? [])).toHaveLength(1)
    expect(html).toContain('Cuenta vinculada')
    expect(html).toContain('data-archived-row="ath_m_archived"')
  })

  it('renderiza el modal con input y confirmacion deshabilitada', () => {
    const html = render('ready', ROSTER, null, [ARCHIVED], ARCHIVED.id)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('Cliente archivada')
    expect(html).toContain('<input')
    const confirmButton = html.match(/<button[^>]*disabled[^>]*>Eliminar<\/button>/)?.[0]
    expect(confirmButton).toBeDefined()
  })

  it('sin archivados no muestra la seccion', () => {
    expect(render('ready', ROSTER)).not.toContain('Archivados (')
  })

  it('una accion de roster pendiente bloquea switches, archivo y restauracion', () => {
    const html = render(
      'ready',
      ROSTER,
      { athleteId: 'ath_m_abc', kind: 'archive' },
      [ARCHIVED],
    )
    const actionButtons = html.match(/<button[^>]*>[^<]*(?:Entrenar como este atleta|Archivar|Restaurar)[^<]*<\/button>/g) ?? []
    expect(actionButtons).not.toHaveLength(0)
    expect(actionButtons.every((button) => button.includes('disabled'))).toBe(true)
  })
})
