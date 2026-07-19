import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachWorkspaceNav from './CoachWorkspaceNav'
import { coachTabId, coachTabPanelId } from './coachWorkspaceTypes'

describe('coachTabId / coachTabPanelId', () => {
  it('generan ids estables por tab', () => {
    expect(coachTabId('alumnos')).toBe('coach-tab-alumnos')
    expect(coachTabPanelId('alumnos')).toBe('coach-tabpanel-alumnos')
  })
})

describe('CoachWorkspaceNav', () => {
  it('renders a tablist with the five areas in order', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="alumnos" onSelect={vi.fn()} />,
    )
    expect(html).toContain('role="tablist"')
    const order = ['Resumen', 'Alumnos', 'Planificación', 'Biblioteca', 'Asistente IA']
    let lastIndex = -1
    for (const label of order) {
      const index = html.indexOf(label)
      expect(index).toBeGreaterThan(lastIndex)
      lastIndex = index
    }
  })

  it('marca el tab activo con role=tab y aria-selected=true', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="alumnos" onSelect={vi.fn()} />,
    )
    const alumnosTab = html.match(/<button[^>]*id="coach-tab-alumnos"[^>]*>/)?.[0]
    expect(alumnosTab).toBeDefined()
    expect(alumnosTab).toContain('role="tab"')
    expect(alumnosTab).toContain('aria-selected="true"')

    const resumenTab = html.match(/<button[^>]*id="coach-tab-resumen"[^>]*>/)?.[0]
    expect(resumenTab).toContain('aria-selected="false"')
  })

  it('cada tab expone aria-controls apuntando a su tabpanel', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="resumen" onSelect={vi.fn()} />,
    )
    expect(html).toContain('aria-controls="coach-tabpanel-biblioteca"')
  })

  it('marca solo Asistente IA como "pronto"', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="resumen" onSelect={vi.fn()} />,
    )
    expect((html.match(/pronto/g) ?? []).length).toBe(1)
  })
})
