import type { Session } from '../types'
import { SESSION_TYPE_CONFIG, SQUASH_SUBTYPE_LABELS } from '../constants/sessionTypes'
import { formatDuration } from './format'

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

function toICSDate(dateISO: string, timeBlock: 'AM' | 'PM'): string {
  // AM sessions start 07:00, PM sessions start 18:00
  const [year, month, day] = dateISO.split('-').map(Number)
  const hour = timeBlock === 'AM' ? 7 : 18
  return `${year}${pad(month)}${pad(day)}T${pad(hour)}0000`
}

function toICSDateEnd(dateISO: string, timeBlock: 'AM' | 'PM', durationMin: number): string {
  const [year, month, day] = dateISO.split('-').map(Number)
  const hour = timeBlock === 'AM' ? 7 : 18
  const totalMin = hour * 60 + durationMin
  const endHour = Math.floor(totalMin / 60)
  const endMin = totalMin % 60
  return `${year}${pad(month)}${pad(day)}T${pad(endHour)}${pad(endMin)}00`
}

function escapeICS(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function sessionToVEVENT(session: Session, uid: string): string {
  const config = SESSION_TYPE_CONFIG[session.type]
  const subtypeLabel = session.subtype ? ` — ${SQUASH_SUBTYPE_LABELS[session.subtype]}` : ''
  const title = `[${config.label}${subtypeLabel}] ${session.title}`

  const descParts: string[] = []
  if (session.objective) descParts.push(`Objetivo: ${session.objective}`)
  if (session.rpe) descParts.push(`RPE planificado: ${session.rpe}`)
  if (session.runningDetails) {
    const rd = session.runningDetails
    descParts.push(`Tipo: ${rd.runningType.toUpperCase()}`)
    if (rd.targetPaceMin) descParts.push(`Ritmo: ${rd.targetPaceMin}–${rd.targetPaceMax} /km`)
    if (rd.targetHrMin) descParts.push(`FC: ${rd.targetHrMin}–${rd.targetHrMax} bpm`)
  }
  if (session.exercises?.length) {
    descParts.push('Ejercicios: ' + session.exercises.map(e =>
      `${e.name} ${e.sets}×${e.reps}${e.weight ? ` ${e.weight}kg` : ''}`
    ).join(', '))
  }
  if (session.notes) descParts.push(`Notas: ${session.notes}`)
  descParts.push(`Duración: ${formatDuration(session.durationMin)}`)

  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}Z`

  return [
    'BEGIN:VEVENT',
    `UID:${uid}@entrenador-app`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toICSDate(session.date, session.timeBlock)}`,
    `DTEND:${toICSDateEnd(session.date, session.timeBlock, session.durationMin)}`,
    `SUMMARY:${escapeICS(title)}`,
    descParts.length ? `DESCRIPTION:${escapeICS(descParts.join('\\n'))}` : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n')
}

export function generateICS(sessions: Session[], calendarName = 'Entrenador — Semana'): string {
  const events = sessions
    .filter(s => s.status !== 'skipped')
    .map((s, i) => sessionToVEVENT(s, `${s.id}-${i}`))
    .join('\r\n')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Entrenador App//ES',
    `X-WR-CALNAME:${escapeICS(calendarName)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    events,
    'END:VCALENDAR',
  ].join('\r\n')
}

export function downloadICS(sessions: Session[], filename = 'entrenador-semana.ics'): void {
  const content = generateICS(sessions)
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
