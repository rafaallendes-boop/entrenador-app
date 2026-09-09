import { materializeRunningTemplate } from '../training/runningTemplateMaterializer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../db/db'
import { exportAppData, parseAppDataExport } from '../dataExport'

const validRef = { source: 'strength_exercise', id: 'back_squat' } as const

function sessionRow(exercises: unknown[]) {
  return {
    id: 'session-ref',
    date: '2026-07-19',
    weekStartDate: '2026-07-13',
    timeBlock: 'AM',
    source: 'coach',
    type: 'strength',
    status: 'planned',
    title: 'Fuerza',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 2,
    exercises,
  }
}

function backupFixture(exercises: unknown[]) {
  return {
    app: 'Entrenador',
    version: 3,
    exportedAt: '2026-07-19T12:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [sessionRow(exercises)],
      dayLogs: [],
      weekSummaries: [],
      trainingPlans: [],
      trainingPlanWeeks: [],
      chatMessages: [],
      coachProposals: [],
      athleteProfiles: [],
    },
  }
}

function backupWithProposalExercise(libraryRef: unknown) {
  const fixture = backupFixture([])
  return {
    ...fixture,
    tables: {
      ...fixture.tables,
      coachProposals: [{
        id: 'p1',
        message: 'm',
        status: 'pending',
        createdAt: 1,
        actions: [{
          type: 'add_session',
          reason: 'r',
          exercises: [{ name: 'Press banca', sets: 3, reps: 5, libraryRef }],
        }],
      }],
    },
  }
}

describe('libraryRef en backup/import', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('round-trip real: exportAppData → parseAppDataExport conserva libraryRef', async () => {
    await db.sessions.put(sessionRow([
      {
        id: 'e1',
        name: 'Sentadilla',
        sets: 4,
        reps: 5,
        completed: false,
        libraryRef: validRef,
      },
    ]) as never)

    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))

    const imported = parsed.tables.sessions.find((session) => session.id === 'session-ref')
    expect(imported?.exercises?.[0].libraryRef).toEqual(validRef)
  })

  it('el espejo de consentimientos no viaja en el backup', async () => {
    const acceptance = {
      id: 'consent-1',
      userId: 'user-1',
      document: 'terms' as const,
      version: '2026-07-13',
      acceptedAt: '2026-08-03T10:00:00.000Z',
    }
    await db.consentAcceptances.put(acceptance)

    const { json } = await exportAppData()
    const exported = JSON.parse(json) as { tables: Record<string, unknown> }
    expect(Object.keys(exported.tables)).not.toContain('consentAcceptances')

    const parsed = parseAppDataExport({
      ...exported,
      tables: { ...exported.tables, consentAcceptances: [acceptance] },
    })
    expect(Object.keys(parsed.tables)).not.toContain('consentAcceptances')
  })

  it('descarta refs inválidos del fixture sin perder el ejercicio', () => {
    const parsed = parseAppDataExport(backupFixture([
      {
        id: 'e1',
        name: 'Sentadilla',
        sets: 4,
        reps: 5,
        completed: false,
        libraryRef: { source: 'nope', id: '' },
      },
      {
        id: 'e2',
        name: 'Peso muerto',
        sets: 4,
        reps: 5,
        completed: false,
        libraryRef: 'garbage',
      },
    ]))

    const imported = parsed.tables.sessions[0].exercises
    expect(imported).toHaveLength(2)
    expect(imported?.[0].libraryRef).toBeUndefined()
    expect(imported?.[1].libraryRef).toBeUndefined()
  })

  it('preserva un ref válido en el import de propuestas pendientes', () => {
    const parsed = parseAppDataExport(backupWithProposalExercise(validRef))
    expect(parsed.tables.coachProposals[0]!.actions[0]!.exercises![0]!.libraryRef).toEqual(validRef)
  })

  it('descarta un ref malformado de una propuesta sin invalidar el ejercicio', () => {
    const parsed = parseAppDataExport(backupWithProposalExercise({ source: 'inventado', id: 42 }))
    const exercise = parsed.tables.coachProposals[0]!.actions[0]!.exercises![0]!
    expect(exercise.libraryRef).toBeUndefined()
    expect(exercise.name).toBe('Press banca')
  })
  it('running y squash conservan prescripción, procedencia y resultado en Dexie → backup → import', async () => {
    const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: { fiveKTime: '25:00', z2PaceMax: '6:30' } })
    if (!dose.ok) throw Error(dose.message)
    const runningDetails = { runningType: 'intervals', templateRef: dose.templateRef, intervalStructure: dose.structure, selectionReason: 'Series específicas' }
    const squashDetails = { trainingFocus: 'technical', sessionKind: 'control', drills: [{ name: 'Salida de pared lateral' }],
      availability: { partnerAvailability: 'solo', court: true, equipment: ['racket', 'ball'], feeder: false },
      technicalIntent: { family: 'wall_exit', side: 'backhand', successTarget: 80 }, technicalResult: { attempts: 20, successes: 17 } }
    await db.sessions.bulkPut([
      { ...sessionRow([]), id: 'run', type: 'running', runningDetails },
      { ...sessionRow([]), id: 'squash', type: 'squash', status: 'adjusted', squashDetails },
    ] as never)
    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))
    expect(parsed.tables.sessions.find(s => s.id === 'run')?.runningDetails).toEqual(runningDetails)
    expect(parsed.tables.sessions.find(s => s.id === 'squash')?.squashDetails).toEqual(squashDetails)
    const proposal = backupWithProposalExercise(undefined)
    proposal.tables.coachProposals[0].actions = [{ type: 'add_session', reason: 'Series', sessionType: 'running', runningType: 'intervals', runningTemplateRef: dose.templateRef, intervalStructure: dose.structure } as never]
    const restored = parseAppDataExport(proposal).tables.coachProposals[0].actions[0]
    expect(restored.runningTemplateRef).toEqual(dose.templateRef)
    expect(restored.intervalStructure).toEqual(dose.structure)
  })

})

/**
 * Regresión del code review del 2026-09-08 (hallazgo 7).
 *
 * `optionalRunningIntervalStructure` es nuevo: antes este campo no se parseaba
 * y se perdía en silencio. Las estructuras persistidas sólo pasaron por
 * `isRunningIntervalStructure`, que no valida más que `Array.isArray(blocks)`,
 * así que existen filas con bloques sin `label`. Hacerlo lanzar abortaba el
 * import completo del backup por una fila vieja.
 */
describe('intervalStructure malformada en backup', () => {
  function runningBackup(intervalStructure: unknown) {
    const fixture = backupFixture([])
    return {
      ...fixture,
      tables: {
        ...fixture.tables,
        sessions: [{
          ...sessionRow([]),
          type: 'running',
          runningDetails: { runningType: 'z2', intervalStructure },
        }],
      },
    }
  }

  it('conserva una estructura válida', () => {
    const parsed = parseAppDataExport((runningBackup({
      blocks: [{ label: 'Rodaje suave', durationMin: 30, role: 'work' }],
    })))
    const [session] = parsed.tables.sessions
    expect(session.runningDetails?.intervalStructure?.blocks).toHaveLength(1)
    expect(session.runningDetails?.intervalStructure?.blocks[0].label).toBe('Rodaje suave')
  })

  it.each([
    ['un bloque sin label', { blocks: [{ durationMin: 30 }] }],
    ['un label vacío', { blocks: [{ label: '   ', durationMin: 30 }] }],
    ['blocks que no es array', { blocks: 'nope' }],
    ['un bloque que no es objeto', { blocks: ['nope'] }],
  ])('degrada %s sin abortar el import', (_caso, intervalStructure) => {
    const parsed = parseAppDataExport((runningBackup(intervalStructure)))
    const [session] = parsed.tables.sessions
    expect(session.runningDetails?.intervalStructure).toBeUndefined()
    // El resto de la fila sobrevive: se pierde la estructura, no la sesión.
    expect(session.id).toBe('session-ref')
    expect(session.runningDetails?.runningType).toBe('z2')
    expect(session.durationMin).toBe(60)
  })
})

/**
 * Regresión encontrada en el smoke de DEV del 2026-09-08, sobre un backup real.
 *
 * El formulario manual guarda una sesión de squash sin ejercicios, y
 * `buildSquashDetailsDraft` emite igual el `squashDetails`. El parser exigía al
 * menos un drill, así que el export producía una fila que el import rechazaba:
 * el backup de ese entorno **no se podía restaurar**, y caía el archivo entero,
 * no la sesión. Es anterior a la entrega de dosis.
 */
describe('squashDetails sin drills en backup', () => {
  function squashBackup(squashDetails: unknown) {
    const fixture = backupFixture([])
    return {
      ...fixture,
      tables: {
        ...fixture.tables,
        sessions: [{ ...sessionRow([]), type: 'squash', squashDetails }],
      },
    }
  }

  it('acepta una lista de drills explícitamente vacía', () => {
    const parsed = parseAppDataExport(squashBackup({
      trainingFocus: 'technical', sessionKind: 'technical', sessionMode: 'drill_session',
      drills: [], blocks: [],
    }))
    const [session] = parsed.tables.sessions
    expect(session.squashDetails?.drills).toEqual([])
    expect(session.squashDetails?.sessionKind).toBe('technical')
    expect(session.id).toBe('session-ref')
  })

  it('sigue rechazando un squashDetails del que no se puede derivar nada', () => {
    expect(() => parseAppDataExport(squashBackup({
      trainingFocus: 'technical', sessionKind: 'technical', sessionMode: 'drill_session',
    }))).toThrow(/al menos un drill/)
  })

  it('deriva los drills desde blocks cuando no viene la lista', () => {
    const parsed = parseAppDataExport(squashBackup({
      trainingFocus: 'technical', sessionKind: 'technical', sessionMode: 'drill_session',
      blocks: [{ kind: 'technical', drills: [{ name: 'Tiros paralelos profundos', durationMin: 20 }] }],
    }))
    expect(parsed.tables.sessions[0].squashDetails?.drills).toHaveLength(1)
  })
})
