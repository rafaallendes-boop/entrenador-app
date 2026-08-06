import { describe, expect, it } from 'vitest'

import { isSessionTemplatePayloadV1 } from '../../../types/sessionTemplate'
import {
  materializeTemplateSession,
  sessionToTemplatePayload,
  templateToDraft,
} from '../../athlete/sessionTemplateSerializer'
import {
  applyCoachSessionPatch,
  draftToNewSessionFields,
  sessionToDraft,
} from '../../athlete/coachSessionSerializer'
import { normalizeSupersetGroups } from '../supersetGroups'

describe('isTemplateExercise', () => {
  const base = { type: 'strength', timeBlock: 'AM', title: 'Fuerza', durationMin: 60 }

  it('acepta un ejercicio con supersetGroup string', () => {
    expect(isSessionTemplatePayloadV1({
      ...base,
      exercises: [{ name: 'Clean', sets: 4, reps: '3', supersetGroup: 'g1' }],
    })).toBe(true)
  })

  it('acepta un ejercicio sin supersetGroup', () => {
    expect(isSessionTemplatePayloadV1({
      ...base,
      exercises: [{ name: 'Clean', sets: 4, reps: '3' }],
    })).toBe(true)
  })

  it('rechaza un supersetGroup no-string', () => {
    expect(isSessionTemplatePayloadV1({
      ...base,
      exercises: [{ name: 'Clean', sets: 4, reps: '3', supersetGroup: 7 }],
    })).toBe(false)
  })
})

// materializeTemplateSession(payload, { date, overlayDraft, originalsById })
// -- sessionTemplateSerializer.ts:383. El draft y el mapa de originales salen
// de templateToDraft, que es como lo llama la UI.

const templateExercise = (name: string, supersetGroup?: string) => ({
  name,
  sets: 4,
  reps: '8',
  ...(supersetGroup ? { supersetGroup } : {}),
})

describe('plantillas y superseries', () => {
  const payload = {
    type: 'strength' as const,
    timeBlock: 'AM' as const,
    title: 'Fuerza',
    durationMin: 60,
    exercises: [
      templateExercise('Clean', 'g1'),
      templateExercise('Dominadas', 'g1'),
      templateExercise('Plancha'),
    ],
  }

  const materializeOnce = (date: string) => {
    const { draft, originalsById } = templateToDraft(payload, date)
    return materializeTemplateSession(payload, { date, overlayDraft: draft, originalsById })
  }

  it('materializar conserva la relacion interna con ids nuevos', () => {
    const session = materializeOnce('2026-08-10')
    const groups = session.exercises!.map((e) => e.supersetGroup)

    expect(groups[0]).toBeDefined()
    expect(groups[0]).toBe(groups[1])
    expect(groups[0]).not.toBe('g1')
    expect(groups[2]).toBeUndefined()
  })

  it('aplicar dos veces la misma plantilla no colisiona', () => {
    const first = materializeOnce('2026-08-10')
    const second = materializeOnce('2026-08-10')

    expect(first.exercises![0]!.supersetGroup).not.toBe(second.exercises![0]!.supersetGroup)
  })

  it('materializar repara un grupo corrupto de la plantilla', () => {
    const corrupto = {
      ...payload,
      exercises: [
        templateExercise('Clean', 'g1'),
        templateExercise('Plancha', 'g2'),      // singleton: debe disolverse
        templateExercise('Dominadas', 'g1'),    // reaparicion: debe disolverse
      ],
    }

    const { draft, originalsById } = templateToDraft(corrupto, '2026-08-10')
    const session = materializeTemplateSession(corrupto, {
      date: '2026-08-10', overlayDraft: draft, originalsById,
    })

    expect(session.exercises!.every((e) => e.supersetGroup == null)).toBe(true)
  })

  it('materializar iguala sets divergentes dentro de un grupo', () => {
    const divergente = {
      ...payload,
      exercises: [
        { ...templateExercise('Clean', 'g1'), sets: 5 },
        { ...templateExercise('Dominadas', 'g1'), sets: 3 },
      ],
    }

    const { draft, originalsById } = templateToDraft(divergente, '2026-08-10')
    const session = materializeTemplateSession(divergente, {
      date: '2026-08-10', overlayDraft: draft, originalsById,
    })

    expect(session.exercises!.map((e) => e.sets)).toEqual([5, 5])
  })

  it('datos antiguos sin el campo permanecen identicos', () => {
    const legacy = [
      { id: 'a', name: 'Clean', sets: 4, reps: '3', completed: false },
      { id: 'b', name: 'Dominadas', sets: 4, reps: '8', completed: false },
    ]

    const normalized = normalizeSupersetGroups(legacy)

    expect(normalized).toEqual(legacy)
    expect(normalized.every((e) => !('supersetGroup' in e))).toBe(true)
  })

  it('guardar una sesion como plantilla conserva sus grupos', () => {
    const saved = sessionToTemplatePayload({
      ...payload,
      exercises: payload.exercises.map((e, index) => ({ ...e, id: `e${index}`, completed: false })),
    } as never)

    expect(saved.exercises!.map((e) => e.supersetGroup)).toEqual(['g1', 'g1', undefined])
  })
})

describe('serializer del editor y superseries', () => {
  const session = {
    id: 's1',
    date: '2026-08-10',
    weekStartDate: '2026-08-10',
    timeBlock: 'AM',
    type: 'strength',
    status: 'planned',
    source: 'coach',
    title: 'Fuerza',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    exercises: [
      { id: 'e1', name: 'Clean', sets: 4, reps: '3', completed: false, supersetGroup: 'g1' },
      { id: 'e2', name: 'Dominadas', sets: 4, reps: '8', completed: false, supersetGroup: 'g1' },
    ],
  } as const

  it('conserva supersetGroup entre sesion, borrador y sesion nueva', () => {
    const draft = sessionToDraft(session as never)
    expect(draft.exercises!.map((exercise) => exercise.supersetGroup)).toEqual(['g1', 'g1'])

    const materialized = draftToNewSessionFields(draft)
    expect(materialized.exercises!.map((exercise) => exercise.supersetGroup)).toEqual(['g1', 'g1'])
  })

  it('permite borrar el grupo al aplicar un patch del editor', () => {
    const draft = sessionToDraft(session as never)
    const exercises = draft.exercises!.map((exercise) => ({ ...exercise, supersetGroup: undefined }))
    const patched = applyCoachSessionPatch(session as never, { exercises })

    expect(patched.exercises!.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })
})
