import { describe, expect, it } from 'vitest'
import type { PlanWizardConfig } from '../../../types'
import { DECLARED_FATIGUE_VALID_DAYS, resolveDeclaredAthleteState, type AthleteDeclaration } from '../../training/strengthAthleteContext'
import { buildWeekUserPrompt } from '../prompts/weekPrompt'
import { buildRepairContextForTest } from './helpers/repairTestFixtures'

/**
 * Verificación adicional obligatoria de T9 — residual I11.
 *
 * B1/B6 (`strengthAthleteContext.ts`) aplican la vigencia de 7 días de la
 * fatiga declarada del wizard (I7): pasado ese plazo, `declaredFatigue` deja
 * de propagarse al selector local de fuerza. El generador de texto del
 * prompt del Plan Builder (`src/services/week/prompts/weekPrompt.ts`,
 * reexportado por `planBuilder/prompts/weekPrompt.ts`) NO conoce esa regla:
 * lee `wizardConfig.currentFatigue` crudo en cada rama, sin mirar
 * `wizardConfig.updatedAt`. Este test caracteriza el hueco, no lo cierra.
 */
describe('Fase B — residual I11: el prompt de texto ignora la vigencia de fatiga', () => {
  const weekStartDate = '2026-09-14'
  // Elapsed 4 días: vigente bajo I7 (< DECLARED_FATIGUE_VALID_DAYS).
  const vigenteUpdatedAt = '2026-09-10T00:00:00.000Z'
  // Elapsed 13 días: vencido bajo I7 (>= DECLARED_FATIGUE_VALID_DAYS).
  const vencidoUpdatedAt = '2026-09-01T00:00:00.000Z'

  it('(1) el resolver local de fuerza (I7) deja de aplicar la fatiga declarada al vencer', () => {
    const declarationVigente: AthleteDeclaration = {
      currentFatigue: 'overloaded',
      currentFitnessLevel: 'fit',
      updatedAt: vigenteUpdatedAt,
    }
    const declarationVencida: AthleteDeclaration = { ...declarationVigente, updatedAt: vencidoUpdatedAt }

    const vigente = resolveDeclaredAthleteState(declarationVigente, weekStartDate)
    const vencida = resolveDeclaredAthleteState(declarationVencida, weekStartDate)

    expect(vigente.declaredFatigue).toBe('overloaded')
    expect(vencida.declaredFatigue).toBeUndefined()
    // Documenta el umbral exacto que separa ambos escenarios.
    expect(DECLARED_FATIGUE_VALID_DAYS).toBe(7)
  })

  it('(2) el prompt de texto produce EXACTAMENTE el mismo contenido dependiente de fatiga vigente o vencida', () => {
    const fixture = buildRepairContextForTest({
      primarySport: 'squash',
      phase: 'build',
      weekStartDate,
      sessionsPerWeek: 5,
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      allowDoubleSession: true,
    })

    const buildWizardConfig = (updatedAt: string): PlanWizardConfig => ({
      ...fixture.wizardConfig,
      currentFatigue: 'overloaded',
      targetHardPrimaryMatches: 2,
      updatedAt,
    })

    const promptVigente = buildWeekUserPrompt({
      plan: fixture.plan,
      week: fixture.week,
      profile: fixture.profile,
      wizardConfig: buildWizardConfig(vigenteUpdatedAt),
    })
    const promptVencido = buildWeekUserPrompt({
      plan: fixture.plan,
      week: fixture.week,
      profile: fixture.profile,
      wizardConfig: buildWizardConfig(vencidoUpdatedAt),
    })

    // Residual: el único input que cambia entre ambas llamadas es
    // `wizardConfig.updatedAt`. El prompt de texto no lo lee en ninguna rama,
    // así que el resultado es carácter por carácter idéntico — mientras que
    // el resolver local de (1) ya habría dejado de aplicar la declaración.
    expect(promptVigente).toBe(promptVencido)

    // Rama "primera semana": `startsLoaded` lee `wizardConfig.currentFatigue`
    // crudo (sin `previousWeek`, `buildLoadDirective` cae en el atajo de
    // primera semana). Presente y textualmente igual en ambos escenarios.
    const startsLoadedLine = 'Primera semana con el atleta cargado: arranca conservador'
    expect(promptVigente).toContain(startsLoadedLine)
    expect(promptVencido).toContain(startsLoadedLine)

    // Rama de exclusión 1: `buildDoubleSessionPreferenceRule` apaga la
    // preferencia de doble sesión cuando `currentFatigue === 'overloaded'`,
    // sin mirar vigencia. El fixture cumple el resto de condiciones
    // (allowDoubleSession, sessionsPerWeek >= 5, cupo de días), así que la
    // única razón de su ausencia es la fatiga cruda.
    const doubleSessionLine = 'Preferencia: usa 1 dia doble'
    expect(promptVigente).not.toContain(doubleSessionLine)
    expect(promptVencido).not.toContain(doubleSessionLine)

    // Rama de exclusión 2: `buildHardPrimaryMatchesRule` resuelve
    // `resolveSquashWeeklyExposurePolicy` con `currentFatigue` crudo;
    // `overloaded` vetea con `severe_overload` ANTES de mirar
    // `targetHardPrimaryMatches` (fijado en 2 arriba). La línea de meta de
    // partidos duros está ausente en ambos escenarios, aunque el resolver de
    // (1) ya no vería fatiga vigente en el caso vencido.
    expect(promptVigente).not.toContain('Partidos duros objetivo esta semana')
    expect(promptVigente).not.toContain('Meta de partidos ajustada por fase/fatiga')
    expect(promptVencido).not.toContain('Partidos duros objetivo esta semana')
    expect(promptVencido).not.toContain('Meta de partidos ajustada por fase/fatiga')

    // Rama descriptiva: la línea literal de fatiga declarada en el perfil
    // también es idéntica — es el mismo valor crudo en ambos casos.
    expect(promptVigente).toContain('Fatiga declarada al iniciar el plan: overloaded')
  })
})
