import { describe, expect, it } from 'vitest'

import { ACTION_CONTRACTS } from '../core/outputContract'
import { validateAgainstContract } from '../validators/validateAgainstContract'

const validSession = () => ({
  date: '2026-05-18',
  timeBlock: 'AM',
  sessionType: 'running',
  title: 'Running Z2',
  durationMin: 45,
  objective: 'base aerobica',
  rpe: 5,
})

const validCreateWeek = () => ({
  type: 'create_week',
  reason: 'semana base de prueba',
  targetDate: '2026-05-18',
  weekObjectives: ['base aerobica', 'movilidad complementaria'],
  sessions: [validSession()],
})

describe('validateAgainstContract — create_week', () => {
  const contract = ACTION_CONTRACTS.create_week

  it('accepts a fully-formed valid action', () => {
    const result = validateAgainstContract(validCreateWeek(), contract)
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('rejects when value is not an object', () => {
    const result = validateAgainstContract('not-an-object', contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week')
  })

  it('rejects when a top-level required field is missing', () => {
    const action = validCreateWeek() as Record<string, unknown>
    delete action.targetDate
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.targetDate')
    expect(result.error).toContain('obligatorio')
  })

  it('rejects when the type discriminator is wrong', () => {
    const action = { ...validCreateWeek(), type: 'something_else' }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.type')
    expect(result.error).toContain('fuera del enum')
  })

  it('rejects when sessions array is empty', () => {
    const action = { ...validCreateWeek(), sessions: [] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.sessions')
    expect(result.error).toContain('no puede estar vacío')
  })

  it('rejects when a session is missing a required base field', () => {
    const session = validSession() as Record<string, unknown>
    delete session.timeBlock
    const action = { ...validCreateWeek(), sessions: [session] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.sessions[0].timeBlock')
  })

  it('rejects when a session.timeBlock has an invalid enum value', () => {
    const session = { ...validSession(), timeBlock: 'EVENING' }
    const action = { ...validCreateWeek(), sessions: [session] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.sessions[0].timeBlock')
    expect(result.error).toContain('"EVENING"')
  })

  it('rejects when sessionType is not in the enum', () => {
    const session = { ...validSession(), sessionType: 'tennis' }
    const action = { ...validCreateWeek(), sessions: [session] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.sessions[0].sessionType')
  })

  it('rejects when durationMin is not an integer', () => {
    const session = { ...validSession(), durationMin: 45.7 }
    const action = { ...validCreateWeek(), sessions: [session] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.sessions[0].durationMin')
    expect(result.error).toContain('entero')
  })

  it('accepts when optional fields are omitted', () => {
    const session = validSession() as Record<string, unknown>
    delete session.rpe
    const action = validCreateWeek() as Record<string, unknown>
    action.sessions = [session]
    delete action.weekObjectives
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(true)
  })

  it('validates required nested fields inside squashDetails when present', () => {
    const session = {
      ...validSession(),
      sessionType: 'squash',
      subtype: 'training',
      squashDetails: {
        sessionMode: 'drill_session',
        drills: [{ name: 'Boast & drive' }],
      },
    }
    const action = { ...validCreateWeek(), sessions: [session] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.sessions[0].squashDetails.trainingFocus')
  })

  it('accepts a valid squash session with all required squashDetails', () => {
    const session = {
      ...validSession(),
      sessionType: 'squash',
      subtype: 'training',
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: 'Boast & drive', durationMin: 10 }],
      },
    }
    const action = { ...validCreateWeek(), sessions: [session] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(true)
  })

  it('rejects when squashDetails.drills is empty', () => {
    const session = {
      ...validSession(),
      sessionType: 'squash',
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [],
      },
    }
    const action = { ...validCreateWeek(), sessions: [session] }
    const result = validateAgainstContract(action, contract)
    expect(result.ok).toBe(false)
    expect(result.path).toBe('create_week.sessions[0].squashDetails.drills')
    expect(result.error).toContain('no puede estar vacío')
  })

  describe('skipDeep option', () => {
    it('does not recurse into skipped object fields', () => {
      // squashDetails is missing trainingFocus (would normally fail) but
      // skipDeep tells the validator to only check it's an object.
      const session = {
        ...validSession(),
        sessionType: 'squash',
        squashDetails: { sessionMode: 'drill_session', drills: [] },
      }
      const action = { ...validCreateWeek(), sessions: [session] }
      const result = validateAgainstContract(action, contract, {
        skipDeep: ['squashDetails'],
      })
      expect(result.ok).toBe(true)
    })

    it('still requires the skipped field to be an object when present', () => {
      const session = { ...validSession(), squashDetails: 'not-an-object' }
      const action = { ...validCreateWeek(), sessions: [session] }
      const result = validateAgainstContract(action, contract, {
        skipDeep: ['squashDetails'],
      })
      expect(result.ok).toBe(false)
      expect(result.path).toBe('create_week.sessions[0].squashDetails')
    })

    it('still validates sibling required fields under the same parent', () => {
      // sessions[0] has timeBlock missing; skipDeep on sport details
      // must not bypass base session field validation.
      const session = validSession() as Record<string, unknown>
      delete session.timeBlock
      const action = { ...validCreateWeek(), sessions: [session] }
      const result = validateAgainstContract(action, contract, {
        skipDeep: ['squashDetails', 'cyclingDetails', 'mobilityDetails'],
      })
      expect(result.ok).toBe(false)
      expect(result.path).toBe('create_week.sessions[0].timeBlock')
    })
  })
})
