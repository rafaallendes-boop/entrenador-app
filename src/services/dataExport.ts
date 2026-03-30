import { db } from '../db/db'

export interface AppDataExport {
  app: 'Entrenador'
  version: 1
  exportedAt: string
  tables: {
    sessions: unknown[]
    dayLogs: unknown[]
    weekSummaries: unknown[]
    chatMessages: unknown[]
  }
}

function buildFilename(exportedAt: Date): string {
  const iso = exportedAt.toISOString().replace(/[:.]/g, '-')
  return `entrenador-backup-${iso}.json`
}

export async function exportAppData(): Promise<{ filename: string; json: string }> {
  const exportedAt = new Date()
  const [sessions, dayLogs, weekSummaries, chatMessages] = await Promise.all([
    db.sessions.toArray(),
    db.dayLogs.toArray(),
    db.weekSummaries.toArray(),
    db.chatMessages.toArray(),
  ])

  const payload: AppDataExport = {
    app: 'Entrenador',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    tables: {
      sessions,
      dayLogs,
      weekSummaries,
      chatMessages,
    },
  }

  return {
    filename: buildFilename(exportedAt),
    json: JSON.stringify(payload, null, 2),
  }
}

export async function downloadAppDataExport(): Promise<string> {
  const { filename, json } = await exportAppData()
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }

  return filename
}
