import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import type { SessionTemplatePayload } from '../../../types/sessionTemplate'
import {
  applyTemplateDraft,
  applyTemplatePatch,
  materializeTemplateSession,
  sessionToTemplatePayload,
  templateDraftToPatch,
  templateDraftToPayload,
  templateToDraft,
} from '../sessionTemplateSerializer'

const richSession = {
  id: 'pb-1',
  athleteId: 'ath_m',
  date: '2026-07-14',
  weekStartDate: '2026-07-13',
  timeBlock: 'AM',
  type: 'squash',
  status: 'completed',
  title: 'PB Squash',
  durationMin: 75,
  source: 'coach',
  authoredByRole: 'coach',
  createdAt: 1,
  updatedAt: 2,
  subtype: 'training',
  objective: 'volea',
  rpe: 7,
  completedAt: 99,
  actualDurationMin: 80,
  actualRpe: 8,
  completionNotes: 'duro',
  opponent: 'Rival X',
  matchResult: 'win',
  gamesWon: 3,
  gamesLost: 1,
  metadata: { starLift: { name: 'Sentadilla', weekProgression: 2 } },
  squashDetails: {
    trainingFocus: 'technical',
    sessionMode: 'drill_session',
    drills: [{ name: 'boast-drive' }],
    blocks: [{ kind: 'technical', drills: [{ name: 'b1' }] }],
  },
  warmup: {
    title: 'W', durationMin: 10, note: '', tone: 'general', steps: [], source: 'base',
  },
  cooldown: {
    title: 'C', durationMin: 5, note: '', tone: 'general', steps: [], source: 'base',
  },
  exercises: [{
    id: 'e1', name: 'Sentadilla', sets: 5, reps: '5', completed: true,
    warmupSets: [{ reps: 5 }], group: 'legs', targetPercent1RM: 80,
  }],
} as Session

describe('sessionToTemplatePayload', () => {
  it('conserva solo lo planificable, incluido contenido rico', () => {
    const payload = sessionToTemplatePayload(richSession)
    expect(payload.squashDetails?.drills).toHaveLength(1)
    expect(payload.squashDetails?.blocks).toHaveLength(1)
    expect(payload.warmup?.title).toBe('W')
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('date')
    expect(payload).not.toHaveProperty('metadata')
    expect(payload).not.toHaveProperty('opponent')
    expect(payload).not.toHaveProperty('completedAt')
    expect(payload).not.toHaveProperty('actualRpe')
  })

  it('quita identidad/estado de ejercicios y conserva metadata', () => {
    const exercise = (
      sessionToTemplatePayload(richSession).exercises?.[0]
    ) as unknown as Record<string, unknown>
    expect(exercise).not.toHaveProperty('id')
    expect(exercise).not.toHaveProperty('completed')
    expect(exercise.warmupSets).toEqual([{ reps: 5 }])
    expect(exercise.group).toBe('legs')
    expect(exercise.targetPercent1RM).toBe(80)
  })

  it('hace una copia profunda', () => {
    const source = structuredClone(richSession) as Session
    const payload = sessionToTemplatePayload(source)
    source.squashDetails!.drills[0].name = 'MUTADO'
    expect(payload.squashDetails?.drills[0].name).toBe('boast-drive')
  })
})

describe('templateDraftToPayload', () => {
  it('genera protocolos y defaults deportivos', () => {
    const payload = templateDraftToPayload({
      date: '2026-07-14', timeBlock: 'AM', type: 'squash', title: 'Drills',
      durationMin: 60, subtype: 'training', objective: 'volea',
    })
    expect(payload.warmup).toBeDefined()
    expect(payload.squashDetails?.sessionMode).toBe('drill_session')
    expect(payload).not.toHaveProperty('date')
  })

  it('normaliza exercises vacío a undefined', () => {
    const payload = templateDraftToPayload({
      date: '2026-07-14', timeBlock: 'AM', type: 'strength', title: 'F',
      durationMin: 45, exercises: [],
    })
    expect(payload.exercises).toBeUndefined()
  })
})

describe('applyTemplateDraft', () => {
  const existing = sessionToTemplatePayload(richSession)

  it('mismo tipo preserva estructuras ricas y actualiza derivados squash', () => {
    const { draft, originalsById } = templateToDraft(existing, '2026-07-14')
    const next = applyTemplateDraft(existing, {
      ...draft,
      title: 'Editada',
      durationMin: 50,
      subtype: 'competitive',
      objective: 'estrategia de presión',
    }, originalsById)
    expect(next).toMatchObject({ title: 'Editada', durationMin: 50 })
    expect(next.squashDetails?.drills).toHaveLength(1)
    expect(next.squashDetails?.blocks).toHaveLength(1)
    expect(next.squashDetails?.sessionMode).toBe('competition_match')
    expect(next.squashDetails?.trainingFocus).toBe('tactical')
    expect(next.warmup?.title).toBe('W')
    expect(next.exercises?.[0]).toMatchObject({
      name: 'Sentadilla', group: 'legs', targetPercent1RM: 80,
    })
  })

  it('preserva intervalStructure al editar targets de running', () => {
    const running = templateDraftToPayload({
      date: '2026-07-14', timeBlock: 'AM', type: 'running', title: 'Series',
      durationMin: 50, runningTargets: { runningType: 'intervals', targetPaceMin: '4:10' },
    })
    running.runningDetails!.intervalStructure = {
      blocks: [{ label: '6x800', repetitions: 6, distanceKm: 0.8 }],
    }
    const { draft, originalsById } = templateToDraft(running, '2026-07-14')
    const next = applyTemplateDraft(running, {
      ...draft,
      runningTargets: { ...draft.runningTargets!, targetPaceMin: '4:00' },
    }, originalsById)
    expect(next.runningDetails?.targetPaceMin).toBe('4:00')
    expect(next.runningDetails?.intervalStructure?.blocks[0].label).toBe('6x800')
  })

  it('regenera cyclingDetails al cambiar zona sin perder campos opacos', () => {
    const cycling = templateDraftToPayload({
      date: '2026-07-14', timeBlock: 'AM', type: 'cycling', title: 'Bici',
      durationMin: 60, runningTargets: { runningType: 'z2' },
    })
    cycling.cyclingDetails = {
      ...cycling.cyclingDetails!,
      sessionFamily: 'familia enriquecida',
      executionNotes: 'Nota del coach',
    }
    const { draft, originalsById } = templateToDraft(cycling, '2026-07-14')
    const next = applyTemplateDraft(cycling, {
      ...draft, runningTargets: { runningType: 'intervals' },
    }, originalsById)
    expect(next.cyclingDetails?.sessionCategory).toBe('primary build')
    expect(next.cyclingDetails?.sessionFamily).toBe('familia enriquecida')
    expect(next.cyclingDetails?.executionNotes).toBe('Nota del coach')
  })

  it('cambio de tipo descarta rico incompatible y conserva metadata de ejercicios', () => {
    const { draft, originalsById } = templateToDraft(existing, '2026-07-14')
    const next = applyTemplateDraft(existing, {
      ...draft, type: 'mobility', subtype: undefined,
    }, originalsById)
    expect(next.type).toBe('mobility')
    expect(next.squashDetails).toBeUndefined()
    expect(next.mobilityDetails).toBeDefined()
    expect(next.exercises?.[0].warmupSets).toEqual([{ reps: 5 }])
  })

  it('mergea ejercicios conservando metadata por identidad efímera', () => {
    const strength = sessionToTemplatePayload({
      ...richSession, type: 'strength', subtype: undefined, squashDetails: undefined,
    } as Session)
    const { draft, originalsById } = templateToDraft(strength, '2026-07-14')
    const next = applyTemplateDraft(strength, {
      ...draft,
      exercises: [{ ...draft.exercises![0], name: 'Sentadilla pausada', sets: 4 }],
    }, originalsById)
    expect(next.exercises?.[0]).toMatchObject({
      name: 'Sentadilla pausada', sets: 4, group: 'legs', targetPercent1RM: 80,
    })
    expect(next.exercises?.[0].warmupSets).toEqual([{ reps: 5 }])
  })

  it('no sintetiza contenido rico ausente al editar una plantilla squash', () => {
    const payload = {
      type: 'squash' as const,
      timeBlock: 'AM' as const,
      title: 'Squash mínimo',
      durationMin: 45,
      subtype: 'training' as const,
    }
    const { draft, originalsById } = templateToDraft(payload, '2026-07-14')

    const edited = applyTemplateDraft(payload, {
      ...draft,
      objective: 'presión y estrategia',
    }, originalsById)
    const patched = applyTemplatePatch(payload, {
      objective: 'presión y estrategia',
    }, originalsById)

    expect(edited.squashDetails).toBeUndefined()
    expect(patched.squashDetails).toBeUndefined()
  })
})

describe('patch concurrente', () => {
  it('aplica solo lo editado contra la versión abierta', () => {
    const opened = sessionToTemplatePayload(richSession)
    const { draft, originalsById } = templateToDraft(opened, '2026-07-14')
    const patch = templateDraftToPatch(opened, { ...draft, durationMin: 50 }, originalsById)
    const latest = {
      ...opened,
      title: 'Título remoto',
      squashDetails: {
        ...opened.squashDetails!,
        drills: [{ name: 'drill remoto' }],
      },
    }
    const merged = applyTemplatePatch(latest, patch, originalsById)
    expect(merged.title).toBe('Título remoto')
    expect(merged.durationMin).toBe(50)
    expect(merged.squashDetails?.drills).toEqual([{ name: 'drill remoto' }])
  })

  it('rechaza un patch con type pero sin draft completo', () => {
    // Un patch con `type` significa cambio de deporte y, por contrato, viaja
    // como draft completo. Sin el guard esto explotaba con un TypeError opaco
    // dentro de draftToNewSessionFields.
    const opened = sessionToTemplatePayload(richSession)
    expect(() => applyTemplatePatch(opened, { type: 'running' }, new Map()))
      .toThrow(/must be a complete draft; missing date, timeBlock, title, durationMin/)
  })

  it('acepta un patch con type cuando el draft está completo', () => {
    const opened = sessionToTemplatePayload(richSession)
    const merged = applyTemplatePatch(opened, {
      date: '2026-07-14',
      timeBlock: 'AM',
      type: 'running',
      title: 'Rodaje',
      durationMin: 40,
    }, new Map())
    expect(merged.type).toBe('running')
    expect(merged.squashDetails).toBeUndefined()
  })
})

describe('materializeTemplateSession', () => {
  it('crea una sesión planned de coach con fecha y UUIDs nuevos', () => {
    const strength = sessionToTemplatePayload({
      ...richSession, type: 'strength', subtype: undefined, squashDetails: undefined,
    } as Session)
    const { draft, originalsById } = templateToDraft(strength, '2026-08-04')
    const fields = materializeTemplateSession(strength, {
      date: '2026-08-04', overlayDraft: draft, originalsById,
    })
    expect(fields).toMatchObject({
      status: 'planned', source: 'coach', date: '2026-08-04', weekStartDate: '2026-08-03',
    })
    expect(fields.exercises?.[0].completed).toBe(false)
    expect(fields.exercises?.[0].id).toBeTruthy()
    expect(fields.exercises?.[0].id).not.toBe('e1')
    expect(fields.exercises?.[0].warmupSets).toEqual([{ reps: 5 }])
    expect(fields).not.toHaveProperty('completedAt')
  })

  it('overlay gana; mismo tipo conserva rico y cambio de tipo lo descarta', () => {
    const payload = sessionToTemplatePayload(richSession)
    const { draft, originalsById } = templateToDraft(payload, '2026-08-03')
    const sameType = materializeTemplateSession(payload, {
      date: '2026-08-03', overlayDraft: { ...draft, title: 'Con drills' }, originalsById,
    })
    expect(sameType.title).toBe('Con drills')
    expect(sameType.squashDetails?.drills).toHaveLength(1)
    expect(sameType.warmup?.title).toBe('W')
    expect(sameType.exercises?.[0]).toMatchObject({
      name: 'Sentadilla', completed: false, group: 'legs', targetPercent1RM: 80,
    })
    expect(sameType.exercises?.[0].id).toBeTruthy()
    expect(sameType.exercises?.[0].id).not.toBe('e1')

    const asRunning = materializeTemplateSession(payload, {
      date: '2026-08-03',
      overlayDraft: {
        ...draft,
        type: 'running',
        subtype: undefined,
        title: 'Rodaje',
        runningTargets: { runningType: 'z2' },
      },
      originalsById,
    })
    expect(asRunning.type).toBe('running')
    expect(asRunning.title).toBe('Rodaje')
    expect(asRunning.squashDetails).toBeUndefined()
    expect(asRunning.runningDetails?.runningType).toBe('z2')
  })

  it('conserva los defaults generados cuando el payload no trae campos ricos', () => {
    const payload = {
      type: 'squash' as const,
      timeBlock: 'AM' as const,
      title: 'Squash mínimo',
      durationMin: 45,
      subtype: 'training' as const,
    }
    const { draft, originalsById } = templateToDraft(payload, '2026-08-03')

    const fields = materializeTemplateSession(payload, {
      date: '2026-08-03', overlayDraft: draft, originalsById,
    })

    expect(fields.squashDetails).toMatchObject({
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
    })
    expect(fields.warmup).toBeDefined()
    expect(fields.cooldown).toBeDefined()
  })
})

describe('libraryRef en plantillas', () => {
  const ref = { source: 'strength_exercise', id: 'back_squat' } as const
  const payload = {
    type: 'strength', timeBlock: 'AM', title: 'Fuerza', durationMin: 60,
    exercises: [
      { name: 'Sentadilla', sets: 4, reps: '5', libraryRef: ref },
      { name: 'Corrupto', sets: 3, reps: '10', libraryRef: { source: 'unknown', id: 'x' } },
    ],
  } as unknown as SessionTemplatePayload

  it('templateToDraft sanitiza: válido pasa, corrupto se descarta sin perder el ejercicio', () => {
    const { draft } = templateToDraft(payload, '2026-07-21')
    expect(draft.exercises?.[0].libraryRef).toEqual(ref)
    expect(draft.exercises?.[1].libraryRef).toBeUndefined()
    expect(draft.exercises?.[1].name).toBe('Corrupto')
  })

  it('applyTemplateDraft respeta el ref del draft (borrado no resucita el original)', () => {
    const { draft, originalsById } = templateToDraft(payload, '2026-07-21')
    const edited = {
      ...draft,
      exercises: [
        { ...draft.exercises![0], name: 'Renombrada', libraryRef: undefined },
        draft.exercises![1],
      ],
    }
    const next = applyTemplateDraft(payload, edited, originalsById)
    expect(next.exercises?.[0].libraryRef).toBeUndefined()
  })

  it('materializeTemplateSession copia refs válidos, descarta corruptos y regenera ids', () => {
    const { draft, originalsById } = templateToDraft(payload, '2026-07-21')
    const fields = materializeTemplateSession(payload, {
      date: '2026-07-21', overlayDraft: draft, originalsById,
    })
    expect(fields.exercises?.[0].libraryRef).toEqual(ref)
    expect(fields.exercises?.[1].libraryRef).toBeUndefined()
    expect(fields.exercises?.[0].id).toBeTruthy()
  })

  it('sessionToTemplatePayload conserva libraryRef mediante copia profunda', () => {
    const session = {
      id: 's1', date: '2026-07-19', weekStartDate: '2026-07-13', timeBlock: 'AM',
      type: 'strength', status: 'planned', title: 'Fuerza', durationMin: 60,
      createdAt: 1, updatedAt: 1,
      exercises: [{
        id: 'e1', name: 'Sentadilla', sets: 4, reps: '5', completed: false,
        libraryRef: { ...ref },
      }],
    } as Session
    const template = sessionToTemplatePayload(session)
    session.exercises![0].libraryRef!.id = 'mutated'
    expect(template.exercises?.[0].libraryRef).toEqual({
      source: 'strength_exercise', id: 'back_squat',
    })
  })
})

describe('exercises de squash en plantillas', () => {
  it('edita exercises de squash sin alterar drills y blocks ricos', () => {
    const payload = sessionToTemplatePayload(richSession)
    const { draft, originalsById } = templateToDraft(payload, '2026-07-21')
    const next = applyTemplateDraft(payload, {
      ...draft,
      exercises: [{ ...draft.exercises![0], name: 'Accesorio editado' }],
    }, originalsById)

    expect(next.exercises?.[0].name).toBe('Accesorio editado')
    expect(next.squashDetails?.drills).toEqual(payload.squashDetails?.drills)
    expect(next.squashDetails?.blocks).toEqual(payload.squashDetails?.blocks)
  })
})
