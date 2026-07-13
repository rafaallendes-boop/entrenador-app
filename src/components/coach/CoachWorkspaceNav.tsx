import type { CoachWorkspaceTab } from './coachWorkspaceTypes'

interface CoachWorkspaceNavProps {
  activeTab: CoachWorkspaceTab
  onSelect: (tab: CoachWorkspaceTab) => void
}

const TABS: { key: CoachWorkspaceTab; label: string; comingSoon: boolean }[] = [
  { key: 'resumen', label: 'Resumen', comingSoon: false },
  { key: 'alumnos', label: 'Alumnos', comingSoon: false },
  { key: 'planificacion', label: 'Planificación', comingSoon: true },
  { key: 'biblioteca', label: 'Biblioteca', comingSoon: true },
  { key: 'asistente', label: 'Asistente IA', comingSoon: true },
]

export function coachTabId(tab: CoachWorkspaceTab): string {
  return `coach-tab-${tab}`
}

export function coachTabPanelId(tab: CoachWorkspaceTab): string {
  return `coach-tabpanel-${tab}`
}

export default function CoachWorkspaceNav({ activeTab, onSelect }: CoachWorkspaceNavProps) {
  return (
    <div
      role="tablist"
      aria-label="Áreas del workspace de coach"
      className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/5 p-1 md:mb-0 md:w-48 md:flex-shrink-0 md:flex-col md:overflow-visible md:border-0 md:bg-transparent md:p-0"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={coachTabId(tab.key)}
            aria-selected={isActive}
            aria-controls={coachTabPanelId(tab.key)}
            onClick={() => onSelect(tab.key)}
            className={`flex-shrink-0 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors md:w-full md:py-2.5 ${
              isActive ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.comingSoon && <span className="ml-1 text-[10px] font-normal opacity-70">(pronto)</span>}
          </button>
        )
      })}
    </div>
  )
}
