import { create } from 'zustand'
import { todayISO, currentWeekStartISO, toISO, getWeekStart, fromISO } from '../utils/date'
import { addWeeks, subWeeks } from 'date-fns'

type DrawerContent = 'addSession' | 'editSession' | 'dayNotes' | null

interface UIState {
  selectedDate: string
  currentWeekStart: string
  drawerOpen: boolean
  drawerContent: DrawerContent
  editingSessionId: string | null

  setSelectedDate: (date: string) => void
  setCurrentWeekStart: (date: string) => void
  navigateWeek: (direction: 'prev' | 'next') => void
  openDrawer: (content: DrawerContent, sessionId?: string) => void
  closeDrawer: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  selectedDate: todayISO(),
  currentWeekStart: currentWeekStartISO(),
  drawerOpen: false,
  drawerContent: null,
  editingSessionId: null,

  setSelectedDate: (date) => set({ selectedDate: date }),
  setCurrentWeekStart: (date) => set({ currentWeekStart: toISO(getWeekStart(fromISO(date))) }),

  navigateWeek: (direction) => {
    const current = fromISO(get().currentWeekStart)
    const next = direction === 'next' ? addWeeks(current, 1) : subWeeks(current, 1)
    set({ currentWeekStart: toISO(getWeekStart(next)) })
  },

  openDrawer: (content, sessionId) =>
    set({ drawerOpen: true, drawerContent: content, editingSessionId: sessionId ?? null }),

  closeDrawer: () =>
    set({ drawerOpen: false, drawerContent: null, editingSessionId: null }),
}))
