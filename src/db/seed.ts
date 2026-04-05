import { db } from './db'
import type { Session, DayLog, WeekSummary } from '../types'
import { v4 as uuid } from '../utils/uuid'
import { toISO, getWeekStart } from '../utils/date'
import { subWeeks, addDays } from 'date-fns'

const s = (partial: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session => ({
  ...partial,
  id: uuid(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const dl = (partial: Omit<DayLog, 'id' | 'updatedAt'>): DayLog => ({
  ...partial,
  id: uuid(),
  updatedAt: Date.now(),
})

export const seedDatabase = async (): Promise<void> => {
  const count = await db.sessions.count()
  if (count > 0) return

  const today = new Date()
  const thisWeek = getWeekStart(today)
  const lastWeek = subWeeks(thisWeek, 1)
  const twoAgo = subWeeks(thisWeek, 2)

  const d = (weekStart: Date, offset: number) => toISO(addDays(weekStart, offset))

  // ── Semana -2 ──────────────────────────────────────────────────────────────
  const w2Sessions: Session[] = [
    s({
      date: d(twoAgo, 0), timeBlock: 'AM',
      type: 'squash', subtype: 'training', status: 'completed',
      title: 'Entrenamiento Técnico', objective: 'Mejorar golpe de esquina y drops',
      durationMin: 90, rpe: 7,
    }),
    s({
      date: d(twoAgo, 1), timeBlock: 'AM',
      type: 'running', status: 'completed',
      title: 'Rodaje Z2', objective: 'Base aeróbica, mantener Z2',
      durationMin: 45, rpe: 5,
      notes: 'Buenas sensaciones, ritmo controlado',
      runningDetails: { runningType: 'z2', targetPaceMin: '5:20', targetPaceMax: '5:50', targetHrMin: 130, targetHrMax: 145 },
    }),
    s({
      date: d(twoAgo, 2), timeBlock: 'AM',
      type: 'strength', status: 'completed',
      title: 'Fuerza Lower', objective: 'Fuerza base piernas — ciclo de fuerza semana 3',
      durationMin: 60, rpe: 7,
      exercises: [
        { id: uuid(), name: 'Sentadilla', sets: 4, reps: 6, weight: 90, completed: true },
        { id: uuid(), name: 'Romanian Deadlift', sets: 3, reps: 8, weight: 70, completed: true },
        { id: uuid(), name: 'Bulgarian Split Squat', sets: 3, reps: '10 c/lado', weight: 20, completed: true },
        { id: uuid(), name: 'Hip Thrust', sets: 3, reps: 12, weight: 80, completed: true },
        { id: uuid(), name: 'Gemelos de pie', sets: 4, reps: 20, weight: 30, completed: true },
      ],
    }),
    s({
      date: d(twoAgo, 3), timeBlock: 'PM',
      type: 'squash', subtype: 'match', status: 'completed',
      title: 'Partido Torneo', objective: 'Aplicar táctica trabajada esta semana',
      durationMin: 75, rpe: 9,
      location: 'Club local',
      opponent: 'Rival A',
      matchResult: 'win',
      gamesWon: 3,
      gamesLost: 1,
      notes: 'Victoria 3-1. Muy buen nivel. Revés mejorado notablemente.',
    }),
    s({
      date: d(twoAgo, 4), timeBlock: 'AM',
      type: 'mobility', status: 'completed',
      title: 'Movilidad Caderas + Tobillo', objective: 'Prevención y amplitud de movimiento',
      durationMin: 30, rpe: 3,
      exercises: [
        { id: uuid(), name: 'Hip 90/90', sets: 3, reps: '60s c/lado', completed: true },
        { id: uuid(), name: 'Pigeon Pose', sets: 2, reps: '90s c/lado', completed: true },
        { id: uuid(), name: 'Movilidad tobillo con pared', sets: 3, reps: '15 c/lado', completed: true },
        { id: uuid(), name: 'World greatest stretch', sets: 3, reps: '8 c/lado', completed: true },
        { id: uuid(), name: 'Deep squat hold', sets: 3, reps: '45s', completed: true },
      ],
    }),
    s({
      date: d(twoAgo, 5), timeBlock: 'AM',
      type: 'squash', subtype: 'control', status: 'completed',
      title: 'Control Técnico', objective: 'Perfeccionar drops y voleas bajo presión',
      durationMin: 60, rpe: 6,
    }),
  ]

  const w2Logs: DayLog[] = [
    dl({ date: d(twoAgo, 0), sleepHours: 8, sleepQuality: 4, energyLevel: 8, rpeActual: 7 }),
    dl({ date: d(twoAgo, 1), sleepHours: 7.5, sleepQuality: 4, energyLevel: 7, rpeActual: 5 }),
    dl({ date: d(twoAgo, 2), sleepHours: 8, sleepQuality: 5, energyLevel: 9, rpeActual: 8, postSessionComment: 'Sentí mucha potencia en sentadilla.' }),
    dl({ date: d(twoAgo, 3), sleepHours: 7, sleepQuality: 3, energyLevel: 7, painLevel: 2, painNotes: 'Leve molestia rodilla derecha post partido', rpeActual: 9 }),
    dl({ date: d(twoAgo, 4), sleepHours: 9, sleepQuality: 5, energyLevel: 7, painLevel: 0 }),
    dl({ date: d(twoAgo, 5), sleepHours: 8, sleepQuality: 4, energyLevel: 8, rpeActual: 6 }),
    dl({ date: d(twoAgo, 6), sleepHours: 9.5, sleepQuality: 5, energyLevel: 9, generalNotes: 'Descanso total. Muy buena semana.' }),
  ]

  const w2Summary: WeekSummary = {
    id: uuid(),
    weekStartDate: toISO(twoAgo),
    totalSessions: 6,
    totalMinutes: 360,
    plannedSessions: 6,
    completedSessions: 6,
    plannedMinutes: 360,
    completedMinutes: 360,
    adherencePct: 100,
    squashSessions: 3,
    runningSessions: 1,
    strengthSessions: 1,
    avgRpe: 6.8,
    avgActualRpe: 6.8,
    avgSleep: 8.1,
    avgEnergy: 8,
    objectives: ['Consolidar técnica de squash', 'Mantener base aeróbica', 'Fuerza de base'],
    coachNote: 'Semana muy completa. Partido ganado con solidez. Rodilla a monitorear.',
    weekNotes: 'Una de las mejores semanas del mes. Balance carga/recuperación óptimo.',
  }

  // ── Semana -1 ──────────────────────────────────────────────────────────────
  const w1Sessions: Session[] = [
    s({
      date: d(lastWeek, 0), timeBlock: 'AM',
      type: 'strength', status: 'completed',
      title: 'Fuerza Upper', objective: 'Empuje + tirón horizontal/vertical',
      durationMin: 60, rpe: 7,
      exercises: [
        { id: uuid(), name: 'Press Banca', sets: 4, reps: 6, weight: 75, completed: true },
        { id: uuid(), name: 'Dominadas', sets: 4, reps: 8, weight: 0, completed: true },
        { id: uuid(), name: 'Press Hombro', sets: 3, reps: 10, weight: 40, completed: true },
        { id: uuid(), name: 'Remo con Barra', sets: 3, reps: 8, weight: 60, completed: true },
        { id: uuid(), name: 'Face Pull', sets: 3, reps: 15, weight: 20, completed: true },
      ],
    }),
    s({
      date: d(lastWeek, 0), timeBlock: 'PM',
      type: 'squash', subtype: 'training', status: 'completed',
      title: 'Entrenamiento Físico Squash', objective: 'Físico + velocidad en cancha',
      durationMin: 90, rpe: 8,
    }),
    s({
      date: d(lastWeek, 1), timeBlock: 'AM',
      type: 'running', status: 'completed',
      title: 'Tempo Run', objective: 'Trabajo umbral anaeróbico',
      durationMin: 55, rpe: 7,
      notes: '3×10min a umbral, recuperación 3min. Buenas sensaciones.',
      runningDetails: { runningType: 'tempo', targetPaceMin: '4:40', targetPaceMax: '4:55', targetHrMin: 160, targetHrMax: 172 },
    }),
    s({
      date: d(lastWeek, 2), timeBlock: 'AM',
      type: 'recovery', status: 'completed',
      title: 'Recuperación Activa', objective: 'Bajar carga acumulada',
      durationMin: 20, rpe: 2,
    }),
    s({
      date: d(lastWeek, 3), timeBlock: 'AM',
      type: 'squash', subtype: 'match', status: 'completed',
      title: 'Partido Torneo', objective: 'Rendir al máximo nivel',
      durationMin: 80, rpe: 9,
      location: 'Club visitante',
      opponent: 'Rival B',
      matchResult: 'loss',
      gamesWon: 2,
      gamesLost: 3,
      notes: 'Semifinal. Derrota 3-2 (11-9 en el quinto). Físico se notó al final.',
    }),
    s({
      date: d(lastWeek, 4), timeBlock: 'AM',
      type: 'mobility', status: 'completed',
      title: 'Movilidad Full Body', objective: 'Recuperación post torneo',
      durationMin: 40, rpe: 3,
      exercises: [
        { id: uuid(), name: 'Cat-Cow', sets: 2, reps: '10 reps', completed: true },
        { id: uuid(), name: 'Hip 90/90 rotations', sets: 3, reps: '8 c/lado', completed: true },
        { id: uuid(), name: 'Thread the needle', sets: 2, reps: '8 c/lado', completed: true },
        { id: uuid(), name: 'Pigeon Pose', sets: 2, reps: '90s c/lado', completed: true },
        { id: uuid(), name: 'Doorframe stretch pecho', sets: 3, reps: '30s', completed: true },
      ],
    }),
    s({
      date: d(lastWeek, 5), timeBlock: 'AM',
      type: 'squash', subtype: 'training', status: 'completed',
      title: 'Entrenamiento Técnico', objective: 'Refinar juego corto y drops',
      durationMin: 90, rpe: 7,
    }),
  ]

  const w1Logs: DayLog[] = [
    dl({ date: d(lastWeek, 0), sleepHours: 7.5, sleepQuality: 4, energyLevel: 8, rpeActual: 8, postSessionComment: 'Doble sesión exigente pero bien.' }),
    dl({ date: d(lastWeek, 1), sleepHours: 8, sleepQuality: 4, energyLevel: 8, rpeActual: 7 }),
    dl({ date: d(lastWeek, 2), sleepHours: 7, sleepQuality: 3, energyLevel: 6, generalNotes: 'Algo cansado por semana previa' }),
    dl({ date: d(lastWeek, 3), sleepHours: 8, sleepQuality: 4, energyLevel: 8, rpeActual: 9, postSessionComment: 'Gran partido. El físico cedió al final, trabajar eso.' }),
    dl({ date: d(lastWeek, 4), sleepHours: 9, sleepQuality: 5, energyLevel: 7, painLevel: 1, painNotes: 'Leve tensión en isquiotibiales' }),
    dl({ date: d(lastWeek, 5), sleepHours: 8, sleepQuality: 4, energyLevel: 8, rpeActual: 7 }),
    dl({ date: d(lastWeek, 6), sleepHours: 9, sleepQuality: 5, energyLevel: 9 }),
  ]

  const w1Summary: WeekSummary = {
    id: uuid(),
    weekStartDate: toISO(lastWeek),
    totalSessions: 7,
    totalMinutes: 435,
    plannedSessions: 7,
    completedSessions: 7,
    plannedMinutes: 435,
    completedMinutes: 435,
    adherencePct: 100,
    squashSessions: 3,
    runningSessions: 1,
    strengthSessions: 1,
    avgRpe: 6.7,
    avgActualRpe: 6.7,
    avgSleep: 8.1,
    avgEnergy: 7.7,
    objectives: ['Torneo fin de semana', 'Mantener fuerza', 'Tempo run umbral'],
    coachNote: 'Gran semana con torneo incluido. La derrota en el 5to set fue física — revisar hidratación y carga pre-torneo. Esta semana foco en recuperar y recargar.',
    weekNotes: 'Semana de alta carga con torneo. Bien gestionada. La derrota enseña mucho.',
  }

  // ── Semana actual ──────────────────────────────────────────────────────────
  const cwSessions: Session[] = [
    s({
      date: d(thisWeek, 0), timeBlock: 'AM',
      type: 'strength', status: 'completed',
      title: 'Fuerza Lower', objective: 'Mantener fuerza base — semana de descarga',
      durationMin: 60, rpe: 7,
      exercises: [
        { id: uuid(), name: 'Sentadilla', sets: 4, reps: 5, weight: 95, completed: true },
        { id: uuid(), name: 'Romanian Deadlift', sets: 3, reps: 8, weight: 72.5, completed: true },
        { id: uuid(), name: 'Bulgarian Split Squat', sets: 3, reps: '8 c/lado', weight: 22.5, completed: true },
        { id: uuid(), name: 'Hip Thrust', sets: 3, reps: 12, weight: 85, completed: true },
        { id: uuid(), name: 'Gemelos de pie', sets: 4, reps: 20, weight: 30, completed: false },
      ],
    }),
    s({
      date: d(thisWeek, 0), timeBlock: 'PM',
      type: 'squash', subtype: 'training', status: 'completed',
      title: 'Entrenamiento Técnico', objective: 'Trabajo de pared y patrones tácticos',
      durationMin: 90, rpe: 7,
      notes: 'Buen entrenamiento. Mejoró continuidad en pared de revés.',
    }),
    s({
      date: d(thisWeek, 1), timeBlock: 'AM',
      type: 'running', status: 'completed',
      title: 'Rodaje Z2 Fácil', objective: 'Recuperación activa aeróbica',
      durationMin: 40, rpe: 5,
      notes: '8km a 5:40/km. Piernas bien.',
      runningDetails: { runningType: 'z2', targetPaceMin: '5:30', targetPaceMax: '6:00', targetHrMin: 128, targetHrMax: 142 },
    }),
    s({
      date: d(thisWeek, 2), timeBlock: 'AM',
      type: 'squash', subtype: 'control', status: 'planned',
      title: 'Control Técnico', objective: 'Voleas y drops bajo presión de tiempo',
      durationMin: 60, rpe: 6,
    }),
    s({
      date: d(thisWeek, 2), timeBlock: 'PM',
      type: 'mobility', status: 'planned',
      title: 'Movilidad Caderas + Columna', objective: 'Prevención y amplitud de cadera',
      durationMin: 25, rpe: 2,
      exercises: [
        { id: uuid(), name: 'Hip 90/90', sets: 3, reps: '60s c/lado', completed: false },
        { id: uuid(), name: 'World greatest stretch', sets: 3, reps: '8 c/lado', completed: false },
        { id: uuid(), name: 'Movilidad torácica con rodillo', sets: 2, reps: '90s', completed: false },
        { id: uuid(), name: 'Pigeon Pose', sets: 2, reps: '90s c/lado', completed: false },
      ],
    }),
    s({
      date: d(thisWeek, 3), timeBlock: 'PM',
      type: 'squash', subtype: 'match', status: 'planned',
      title: 'Partido Liga', objective: 'Ganar con solvencia aplicando táctica',
      durationMin: 75, rpe: 8,
      location: 'Club local',
      opponent: 'Rival C',
    }),
    s({
      date: d(thisWeek, 4), timeBlock: 'AM',
      type: 'strength', status: 'planned',
      title: 'Fuerza Upper', objective: 'Trabajo de empuje y core',
      durationMin: 55, rpe: 7,
      exercises: [
        { id: uuid(), name: 'Press Banca', sets: 4, reps: 6, weight: 77.5, completed: false },
        { id: uuid(), name: 'Dominadas', sets: 4, reps: 8, weight: 0, completed: false },
        { id: uuid(), name: 'Press Hombro', sets: 3, reps: 10, weight: 42.5, completed: false },
        { id: uuid(), name: 'Remo con Mancuerna', sets: 3, reps: '10 c/lado', weight: 32, completed: false },
        { id: uuid(), name: 'Plancha RKC', sets: 3, reps: '30s', weight: 0, completed: false },
      ],
    }),
    s({
      date: d(thisWeek, 5), timeBlock: 'AM',
      type: 'squash', subtype: 'training', status: 'planned',
      title: 'Entrenamiento Intensidad', objective: 'Físico de alta intensidad en cancha',
      durationMin: 90, rpe: 8,
    }),
    s({
      date: d(thisWeek, 6), timeBlock: 'AM',
      type: 'running', status: 'planned',
      title: 'Long Run', objective: 'Volumen aeróbico semanal largo',
      durationMin: 65, rpe: 6,
      runningDetails: { runningType: 'long', targetPaceMin: '5:30', targetPaceMax: '6:10', targetHrMin: 130, targetHrMax: 148 },
    }),
  ]

  const cwSummary: WeekSummary = {
    id: uuid(),
    weekStartDate: toISO(thisWeek),
    totalSessions: 3,
    totalMinutes: 190,
    plannedSessions: 8,
    completedSessions: 3,
    plannedMinutes: 500,
    completedMinutes: 190,
    adherencePct: 38,
    squashSessions: 1,
    runningSessions: 1,
    strengthSessions: 1,
    avgRpe: 6.3,
    avgActualRpe: 6.7,
    avgSleep: 7.8,
    avgEnergy: 7.5,
    objectives: [
      'Recuperar bien tras torneo de la semana pasada',
      'Mantener trabajo de fuerza (no reducir intensidad)',
      'Ganar partido de liga del jueves con solvencia',
    ],
    coachNote: 'Semana de recarga. Lun–Mar completados con buenas sensaciones. Hoy control técnico — mantén intensidad controlada para llegar fresco al partido del jueves.',
  }

  await db.transaction('rw', db.sessions, db.dayLogs, db.weekSummaries, async () => {
    await db.sessions.bulkAdd([...w2Sessions, ...w1Sessions, ...cwSessions])
    await db.dayLogs.bulkAdd([...w2Logs, ...w1Logs])
    await db.weekSummaries.bulkAdd([w2Summary, w1Summary, cwSummary])
  })
}
