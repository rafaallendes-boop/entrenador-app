/**
 * PDF Import Service
 *
 * Capabilities:
 * - Extracts text from PDF using pdf.js
 * - Sends extracted text to the active AI provider for structured session extraction
 * - Falls back to pattern matching when AI is unavailable or fails
 * - Keeps review and confirmation in the UI before importing
 *
 * Notes:
 * - Scanned or image-only PDFs may not contain a readable text layer
 * - pdf.js is loaded on demand to keep the initial PDF screen lighter
 */

import type { ParsedSessionDraft, SessionType, TimeBlock } from '../types'
import { CoachEngine } from './ai/CoachEngine'

interface PdfJsModule {
  GlobalWorkerOptions: {
    workerSrc: string
  }
  getDocument: (src: { data: ArrayBuffer }) => {
    promise: Promise<{
      numPages: number
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{
          items: Array<{ str?: string }>
        }>
      }>
    }>
  }
}

let pdfJsLoader: Promise<PdfJsModule> | null = null

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsLoader) {
    pdfJsLoader = Promise.all([
      import('pdfjs-dist/build/pdf.min.mjs'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjsLib, workerUrl]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.default
      return pdfjsLib as PdfJsModule
    })
  }

  return pdfJsLoader
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str ?? '' : ''))
      .join(' ')
    pages.push(pageText)
  }

  return pages.join('\n')
}

const TYPE_PATTERNS: Array<{ pattern: RegExp; type: SessionType }> = [
  { pattern: /squash|pista|cancha/i, type: 'squash' },
  { pattern: /running|rodaje|carrera|corr/i, type: 'running' },
  { pattern: /fuerza|gym|pesas|press|sentadill/i, type: 'strength' },
  { pattern: /movilidad|mobility|estiramiento|flexibilidad/i, type: 'mobility' },
  { pattern: /recuperaci[oó]n|recovery|descanso activo/i, type: 'recovery' },
]

const TIME_BLOCK_PATTERN: Record<TimeBlock, RegExp> = {
  AM: /ma[nñ]ana|AM|morning|\b[0-9]{1,2}h\b.*ma[nñ]/i,
  PM: /tarde|PM|evening|noche/i,
}

const DAY_NAMES: Record<string, number> = {
  lunes: 0, monday: 0,
  martes: 1, tuesday: 1,
  miercoles: 2, miércoles: 2, wednesday: 2,
  jueves: 3, thursday: 3,
  viernes: 4, friday: 4,
  sabado: 5, sábado: 5, saturday: 5,
  domingo: 6, sunday: 6,
}

function detectType(text: string): SessionType | undefined {
  for (const { pattern, type } of TYPE_PATTERNS) {
    if (pattern.test(text)) return type
  }
  return undefined
}

function detectTimeBlock(text: string): TimeBlock {
  if (TIME_BLOCK_PATTERN.PM.test(text)) return 'PM'
  return 'AM'
}

function detectDuration(text: string): number | undefined {
  const minutes = text.match(/(\d+)\s*min/i)
  if (minutes) return Number(minutes[1])

  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*h(?:ora)?s?\b/i)
  if (hours) return Math.round(Number(hours[1].replace(',', '.')) * 60)

  return undefined
}

function detectRpe(text: string): number | undefined {
  const match = text.match(/rpe\s*:?\s*(\d+)/i) ?? text.match(/intensidad\s*:?\s*(\d+)/i)
  if (match) return Math.min(10, Number(match[1]))
  return undefined
}

export function parseSessionsFromText(
  text: string,
  referenceWeekStart: string,
): ParsedSessionDraft[] {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const drafts: ParsedSessionDraft[] = []

  let currentDayOffset: number | null = null
  let currentBlock: string[] = []

  const flushBlock = () => {
    if (currentBlock.length === 0 || currentDayOffset === null) return

    const blockText = currentBlock.join(' ')
    const type = detectType(blockText)
    if (!type) {
      currentBlock = []
      return
    }

    const [year, month, day] = referenceWeekStart.split('-').map(Number)
    const base = new Date(year, month - 1, day)
    base.setDate(base.getDate() + currentDayOffset)

    const date = base.toISOString().split('T')[0]
    const draft: ParsedSessionDraft = {
      date,
      type,
      timeBlock: detectTimeBlock(blockText),
      title: currentBlock[0]?.slice(0, 60) || `Sesion ${type}`,
      durationMin: detectDuration(blockText),
      rpe: detectRpe(blockText),
      rawText: blockText.slice(0, 300),
      confidence: 'low',
    }

    const signals = [type, draft.durationMin, draft.rpe, draft.date].filter(Boolean).length
    draft.confidence = signals >= 3 ? 'medium' : 'low'

    drafts.push(draft)
    currentBlock = []
  }

  for (const line of lines) {
    const lower = line.toLowerCase()
    const dayIndex = Object.entries(DAY_NAMES).find(([name]) => lower.includes(name))?.[1]

    if (dayIndex !== undefined) {
      flushBlock()
      currentDayOffset = dayIndex
      currentBlock = [line]
      continue
    }

    if (currentDayOffset !== null) {
      currentBlock.push(line)
    }
  }

  flushBlock()
  return drafts
}

function buildWeekDateMap(weekStart: string): Record<string, string> {
  const [year, month, day] = weekStart.split('-').map(Number)
  const base = new Date(year, month - 1, day)
  const days = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo']
  const map: Record<string, string> = {}

  days.forEach((name, index) => {
    const date = new Date(base)
    date.setDate(base.getDate() + index)
    map[name] = date.toISOString().split('T')[0]
  })

  return map
}

function buildExtractionPrompt(weekStart: string): string {
  const dates = buildWeekDateMap(weekStart)
  const dateTable = Object.entries(dates)
    .map(([day, iso]) => `- ${day}: ${iso}`)
    .join('\n')

  return `Eres un extractor de datos de entrenamiento deportivo.
Tu unica tarea es analizar el texto de una planificacion y devolver las sesiones en JSON puro.

Semana de referencia:
${dateTable}

Devuelve UNICAMENTE un array JSON valido. Sin texto antes ni despues, sin bloques markdown.
Cada elemento debe seguir exactamente esta estructura y usar null para campos desconocidos:
{
  "date": "YYYY-MM-DD",
  "type": "squash" | "running" | "strength" | "mobility" | "recovery" | "nutrition",
  "timeBlock": "AM" | "PM",
  "title": string,
  "durationMin": number | null,
  "rpe": number | null,
  "objective": string | null,
  "notes": string | null,
  "subtype": "control" | "training" | "match" | "competitive" | "light" | null,
  "runningDetails": { "runningType": "z2" | "tempo" | "intervals" | "long", "targetPaceMin": string | null, "targetPaceMax": string | null } | null
}

Reglas:
- date: usa las fechas absolutas de la tabla segun el dia detectado
- subtype: solo para "squash"
- runningDetails: solo para "running"
- si no hay sesiones detectables, devuelve []
- nunca devuelvas texto fuera del array JSON`
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
}

async function extractSessionsWithAI(
  rawText: string,
  referenceWeekStart: string,
): Promise<ParsedSessionDraft[] | null> {
  if (!CoachEngine.isRealProviderConfigured()) return null

  try {
    const systemPrompt = buildExtractionPrompt(referenceWeekStart)
    const responseText = await CoachEngine.extractRaw(systemPrompt, rawText, {
      maxTokens: 2000,
      temperature: 0.1,
    })

    const cleaned = stripCodeFences(responseText)
    const parsed: unknown = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return null

    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        date: typeof item.date === 'string' ? item.date : undefined,
        type: typeof item.type === 'string' ? (item.type as SessionType) : undefined,
        timeBlock: typeof item.timeBlock === 'string' ? (item.timeBlock as TimeBlock) : 'AM',
        title: typeof item.title === 'string' ? item.title : undefined,
        durationMin: typeof item.durationMin === 'number' ? item.durationMin : undefined,
        rpe: typeof item.rpe === 'number' ? item.rpe : undefined,
        objective: typeof item.objective === 'string' ? item.objective : undefined,
        notes: typeof item.notes === 'string' ? item.notes : undefined,
        subtype: typeof item.subtype === 'string' ? (item.subtype as ParsedSessionDraft['subtype']) : undefined,
        runningDetails: item.runningDetails && typeof item.runningDetails === 'object'
          ? (item.runningDetails as ParsedSessionDraft['runningDetails'])
          : undefined,
        confidence: 'high' as const,
      }))
      .filter((draft) => draft.date && draft.type && draft.title)
  } catch {
    return null
  }
}

export interface PDFImportResult {
  rawText: string
  drafts: ParsedSessionDraft[]
  warnings: string[]
  usedAI: boolean
}

export async function importFromPDF(
  file: File,
  referenceWeekStart: string,
): Promise<PDFImportResult> {
  const warnings: string[] = []

  if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
    throw new Error('El archivo debe ser un PDF')
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('El PDF es demasiado grande (max 10 MB)')
  }

  let rawText = ''

  try {
    rawText = await extractTextFromPDF(file)
  } catch {
    throw new Error('No se pudo leer el PDF. Prueba con un PDF de texto, no escaneado.')
  }

  if (rawText.trim().length < 50) {
    warnings.push(
      'Se extrajo muy poco texto del PDF. Puede ser un PDF escaneado o de imagen. La deteccion automatica puede fallar.',
    )
  }

  const aiResult = await extractSessionsWithAI(rawText, referenceWeekStart)
  const usedAI = aiResult !== null
  const drafts = aiResult ?? parseSessionsFromText(rawText, referenceWeekStart)

  if (drafts.length === 0) {
    warnings.push(
      'No se detectaron sesiones en el PDF. Puedes anadir sesiones manualmente con el boton correspondiente.',
    )
  }

  return { rawText, drafts, warnings, usedAI }
}
