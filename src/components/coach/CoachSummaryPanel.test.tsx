import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachSummaryPanel from './CoachSummaryPanel'
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

const SELF: Athlete = { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 }
const MANAGED: Athlete = { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 }

function render(status: RosterStatus, athletes: Athlete[] = [], pendingAction: PendingAthleteAction | null = null) {
  return renderToStaticMarkup(
    <CoachSummaryPanel
      athletes={athletes}
      status={status}
      selfId="ath_user-1"
      activeAthleteId="ath_user-1"
      pendingAction={pendingAction}
      onRetry={vi.fn()}
      onOpenWeek={vi.fn()}
      onOpenPlan={vi.fn()}
      onGoToAlumnos={vi.fn()}
    />,
  )
}

describe('CoachSummaryPanel', () => {
  it('loading: muestra estado de carga sin tarjetas', () => {
    const html = render('loading')
    expect(html).toContain('Cargando tus atletas')
    expect(html).not.toContain('Ver semana')
  })

  it('error: muestra mensaje y boton de reintentar', () => {
    const html = render('error')
    expect(html).toContain('No pudimos cargar tu roster')
    expect(html).toContain('Reintentar')
  })

  it('roster realmente vacio (defensivo): muestra CTA para ir a Alumnos', () => {
    const html = render('ready', [])
    expect(html).toContain('Aún no tienes atletas activos')
    expect(html).toContain('Ir a Alumnos para crear uno')
  })

  it('solo self (caso real de coach nuevo): muestra la tarjeta "Tú" y el bloque de agregar alumnos', () => {
    const html = render('ready', [SELF])
    expect(html).toContain('Tú')
    expect(html).toContain('Ver semana')
    expect(html).toContain('Aún no agregaste alumnos')
    expect(html).toContain('Ir a Alumnos para agregar el primero')
  })

  it('con alumno gestionado: no muestra el bloque de "agregar alumnos"', () => {
    const html = render('ready', [SELF, MANAGED])
    expect(html).toContain('Cliente 1')
    expect(html).not.toContain('Aún no agregaste alumnos')
    expect((html.match(/Ver semana/g) ?? []).length).toBe(2)
    expect((html.match(/Ver plan/g) ?? []).length).toBe(2)
  })

  it('accion pendiente: relabela solo el boton acted-on pero deshabilita todos', () => {
    const html = render('ready', [SELF, MANAGED], { athleteId: 'ath_m_abc', kind: 'week' })
    const managedCard = html.slice(html.indexOf('Cliente 1'))
    expect(managedCard).toContain('Abriendo semana…')

    // El label solo cambia en el boton exacto (mismo athleteId + kind).
    expect(managedCard).toContain('Ver plan')
    const selfCard = html.slice(0, html.indexOf('Cliente 1'))
    expect(selfCard).toContain('Ver semana')
    expect(selfCard).not.toContain('Abriendo semana…')

    // Pero ningun boton de atleta queda clickeable: los switches se serializan.
    expect((html.match(/disabled/g) ?? []).length).toBe(4)
  })
})
