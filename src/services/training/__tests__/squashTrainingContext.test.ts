import { expect, it } from 'vitest'
import type { Session } from '../../../types'
import { selectSquashDrills, deriveSquashProgressionState } from '../drillSelector'
import { findSquashDrillByName, getSquashDrillFamily, isSquashDrillAvailable } from '../drillLibrary'
import { SQUASH_CATALOG_EXPANSION } from '../squashCatalogExpansion'
import { hydrateSquashSession } from '../squashSessionHydrator'
import { applyCoachSessionPatch, draftToNewSessionFields, sessionToDraft } from '../../athlete/coachSessionSerializer'
import { sessionToTemplatePayload } from '../../athlete/sessionTemplateSerializer'

const context = { phase: 'base' as const, fatigueLevel: 4, competitionSoon: false, recentDrills: [], goal: '', referenceDate: '2026-09-07' }
it('familia técnica es independiente de ejecución y el objetivo dirige selección', () => {
  const result = selectSquashDrills({ ...context, desiredKind: 'control', technicalIntent: { family: 'wall_exit', side: 'backhand', successTarget: 80 }, availability: { partnerAvailability: 'solo' } })
  expect(result.drills.some(d => findSquashDrillByName(d.name)?.id === 'wall_exit_control')).toBe(true)
  expect(getSquashDrillFamily(findSquashDrillByName('solo_volleys_only')!)).toBe('volley_patterns')
})
it('override sin cancha ni material sólo entrega trabajo ejecutable; feeder y coach son recursos reales', () => {
  const availability = { partnerAvailability: 'solo' as const, court: false, equipment: [], feeder: false, coach: false }
  const result = hydrateSquashSession({ ...context, kind: 'shadows', durationMin: 30, availability })
  expect(result.details.drills.length).toBeGreaterThan(0)
  expect(result.details.drills.every(d => isSquashDrillAvailable(findSquashDrillByName(d.name)!, availability))).toBe(true)
  expect(isSquashDrillAvailable(SQUASH_CATALOG_EXPANSION.find(d => d.id === 'feeder_front_court')!, availability)).toBe(false)
  expect(isSquashDrillAvailable(SQUASH_CATALOG_EXPANSION.find(d => d.id === 'coach_volley_progression')!, availability)).toBe(false)
  expect(hydrateSquashSession({ ...context, kind: 'technical', durationMin: 30, availability }).details.drills).toEqual([])
})
it('sólo progresa con dos resultados ejecutados que alcanzan el objetivo declarado', () => {
  const sessions = ['2026-09-06', '2026-09-04'].map(date => ({ date, timeBlock: 'AM', status: 'adjusted', type: 'squash', actualRpe: 5,
    squashDetails: { trainingFocus: 'technical', drills: [{ name: 'Drives paralelos profundos' }], technicalIntent: { family: 'drive_patterns', successTarget: 80 }, technicalResult: { attempts: 20, successes: 18 } } })) as Session[]
  expect(deriveSquashProgressionState({ ...context, historicalSessions: sessions }).recommendation).toBe('progress')
  expect(deriveSquashProgressionState({ ...context, historicalSessions: sessions.map(s => ({ ...s, status: 'planned' })) }).recommendation).toBe('hold')
  expect(deriveSquashProgressionState({ ...context, historicalSessions: sessions.map(s => ({ ...s, squashDetails: { ...s.squashDetails!, technicalResult: { attempts: 20, successes: 10 } } })) }).recommendation).toBe('hold')
})
it('guarda y edita intención/resultados; las plantillas reutilizables excluyen resultados realizados', () => {
  const draft = { date: '2026-09-07', timeBlock: 'AM' as const, type: 'squash' as const, title: 'Precisión', durationMin: 30,
    squashTraining: { availability: { partnerAvailability: 'solo' as const }, technicalIntent: { family: 'drive_patterns', successTarget: 80 }, technicalResult: { attempts: 20, successes: 18 } } }
  const session = { ...draftToNewSessionFields(draft), id: 'test', createdAt: 1, updatedAt: 1 } as Session
  expect(sessionToDraft(session).squashTraining).toEqual(draft.squashTraining)
  const patched = applyCoachSessionPatch(session, { squashTraining: { ...draft.squashTraining, technicalResult: { attempts: 30, successes: 24 } } })
  expect(patched.squashDetails?.technicalResult?.successes).toBe(24)
  expect(sessionToTemplatePayload(patched).squashDetails?.technicalResult).toBeUndefined()
})
