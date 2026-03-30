/**
 * PDF Import Service — v1 stub
 *
 * CURRENT CAPABILITY:
 *   - Reads raw text from a PDF file using the browser's built-in FileReader
 *   - Attempts basic pattern matching to detect sessions from text
 *   - All parsed sessions are marked with confidence 'low' or 'medium'
 *   - User must review and confirm before importing
 *
 * LIMITATIONS (v1):
 *   - No actual PDF parsing library (PDF.js is NOT bundled yet)
 *   - Text extraction is only reliable for text-layer PDFs (not scanned images)
 *   - Pattern matching is heuristic — structured planning PDFs work best
 *   - Exercise blocks inside sessions are NOT parsed in v1
 *
 * TO UPGRADE TO v1.1:
 *   - npm install pdfjs-dist
 *   - Replace extractTextFromPDF with pdf.js implementation
 *   - Add smarter NLP or regex for session blocks
 *
 * TO UPGRADE TO v2 (AI-powered):
 *   - Send extracted text to Claude API with a structured extraction prompt
 *   - Claude returns ParsedSessionDraft[] as JSON
 *   - Higher confidence, supports unstructured formats
 */

import type { ParsedSessionDraft, SessionType, TimeBlock } from '../types'

// ─── Text extraction stub ─────────────────────────────────────────────────────

/**
 * Attempts to extract text content from a PDF File object.
 * v1: Reads as ArrayBuffer and decodes visible ASCII strings.
 * This works for simple text-layer PDFs but is NOT reliable.
 * For proper parsing, integrate pdf.js.
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer
      if (!buffer) { reject(new Error('No se pudo leer el archivo')); return }

      // Naive: decode as latin-1 and extract printable strings
      const bytes = new Uint8Array(buffer)
      const chunks: string[] = []
      let current = ''
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]
        if (b >= 32 && b < 127) {
          current += String.fromCharCode(b)
        } else {
          if (current.length > 4) chunks.push(current)
          current = ''
        }
      }
      if (current.length > 4) chunks.push(current)
      resolve(chunks.join('\n'))
    }
    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

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

// Simple day detection: "Lunes", "Martes", etc. → number 0–6
const DAY_NAMES: Record<string, number> = {
  lunes: 0, monday: 0,
  martes: 1, tuesday: 1,
  miércoles: 2, miercoles: 2, wednesday: 2,
  jueves: 3, thursday: 3,
  viernes: 4, friday: 4,
  sábado: 5, sabado: 5, saturday: 5,
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
  const m = text.match(/(\d+)\s*min/i)
  if (m) return Number(m[1])
  const h = text.match(/(\d+(?:[.,]\d+)?)\s*h(?:ora)?s?\b/i)
  if (h) return Math.round(Number(h[1].replace(',', '.')) * 60)
  return undefined
}

function detectRpe(text: string): number | undefined {
  const m = text.match(/rpe\s*:?\s*(\d+)/i) ?? text.match(/intensidad\s*:?\s*(\d+)/i)
  if (m) return Math.min(10, Number(m[1]))
  return undefined
}

/**
 * Given raw extracted text, attempt to find week sessions.
 * Splits by day-name lines and extracts one draft per detected block.
 */
export function parseSessionsFromText(
  text: string,
  referenceWeekStart: string
): ParsedSessionDraft[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const drafts: ParsedSessionDraft[] = []

  let currentDayOffset: number | null = null
  let currentBlock: string[] = []

  const flushBlock = () => {
    if (currentBlock.length === 0 || currentDayOffset === null) return
    const blockText = currentBlock.join(' ')
    const type = detectType(blockText)
    if (!type) { currentBlock = []; return }

    // Calculate date from week start + offset
    const [y, mo, d] = referenceWeekStart.split('-').map(Number)
    const base = new Date(y, mo - 1, d)
    base.setDate(base.getDate() + currentDayOffset)
    const date = base.toISOString().split('T')[0]

    const draft: ParsedSessionDraft = {
      date,
      type,
      timeBlock: detectTimeBlock(blockText),
      title: currentBlock[0]?.slice(0, 60) || `Sesión ${type}`,
      durationMin: detectDuration(blockText),
      rpe: detectRpe(blockText),
      rawText: blockText.slice(0, 300),
      confidence: 'low',
    }

    // Upgrade confidence if multiple signals detected
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
    } else if (currentDayOffset !== null) {
      currentBlock.push(line)
    }
  }
  flushBlock()

  return drafts
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export interface PDFImportResult {
  rawText: string
  drafts: ParsedSessionDraft[]
  warnings: string[]
}

export async function importFromPDF(
  file: File,
  referenceWeekStart: string
): Promise<PDFImportResult> {
  const warnings: string[] = []

  if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
    throw new Error('El archivo debe ser un PDF')
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('El PDF es demasiado grande (máx 10 MB)')
  }

  warnings.push(
    'Versión 1: la lectura automática de PDF es experimental. Revisa todos los campos antes de importar.'
  )

  let rawText = ''
  try {
    rawText = await extractTextFromPDF(file)
  } catch {
    throw new Error('No se pudo leer el PDF. Prueba con un PDF de texto (no escaneado).')
  }

  if (rawText.trim().length < 50) {
    warnings.push(
      'Se extrajo muy poco texto del PDF. Puede ser un PDF escaneado o de imagen. La detección automática puede fallar.'
    )
  }

  const drafts = parseSessionsFromText(rawText, referenceWeekStart)

  if (drafts.length === 0) {
    warnings.push(
      'No se detectaron sesiones en el PDF. Puedes añadir sesiones manualmente con el botón "Añadir".'
    )
  }

  return { rawText, drafts, warnings }
}
