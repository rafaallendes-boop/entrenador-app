import type { QualityDensity } from './criticalRules'

export interface CompetitionRulesInput {
  density: QualityDensity
  playsSquash: boolean
  hasRunning: boolean
}

export function buildCompetitionRulesSection(input: CompetitionRulesInput): string {
  return input.density === 'compact'
    ? buildCompactCompetitionRulesSection(input.playsSquash, input.hasRunning)
    : buildFullCompetitionRulesSection(input.playsSquash, input.hasRunning)
}

function buildFullCompetitionRulesSection(playsSquash: boolean, hasRunning: boolean): string {
  return `SEMANA COMPETITIVA Y PRE-TORNEO:
- Si aparece un partido o torneo, el objetivo principal pasa a ser rendir fresco en cancha.
- Si faltan 2 dias o menos para competir, evita agregar sesiones que dejen DOMS o fatiga metabolica alta.
- Fuerza en semana competitiva: volumen bajo, foco neural/estabilidad, nunca pesada pegada al partido.
${hasRunning ? '- Running en semana competitiva: Z2 corto o activacion; evita tempo o intervalos largos salvo que esten lejos del partido.' : ''}
- Pre-competencia (deporte principal): sesion tecnica corta o activacion especifica; no sesiones largas de desgaste.${playsSquash ? '\n- Squash pre-partido: control tecnico, precision, sensaciones, la T, largo-corto, activacion de pies; no sesiones de RSA ni carga fisica alta.' : ''}
- Si el usuario menciona torneo, liga, rival, cuadro o fin de semana competitivo, debes responder como RallyIQ en taper, no como semana base normal.
- El deporte accesorio en semana competitiva no debe quitar frescura a la sesion objetivo del deporte principal.
- Si hay competencia objetivo, prioriza cardio recovery o Z2 corto; deja intensidad alta fuera de la ventana sensible.
- Si hay varias competencias, distingue entre sesion objetivo inmediata y carga secundaria; protege primero la inmediata.
- Un control no compite por prioridad con un match o competitive; usalo como ajuste tecnico o activacion.
${hasRunning ? '- Un match o competitive mas cercano manda sobre cualquier desarrollo de running de esa misma ventana.' : ''}
- Si el deporte principal es fuerza, trata la fuerza como disciplina principal: lift central, accesorios coherentes, trunk y progresion real.
- Si la fuerza no es principal, ajusta el volumen para que complemente al deporte objetivo y no robe frescura.
- No uses la misma receta de pesas para todos: decide entre fuerza, hipertrofia, potencia, estabilidad o recovery segun fase, fatiga, historial y rol de la fuerza.`
}

function buildCompactCompetitionRulesSection(playsSquash: boolean, hasRunning: boolean): string {
  return `SEMANA COMPETITIVA Y PRE-TORNEO:
- Si aparece partido/torneo, planifica como taper: frescura primero.
- A 0-2 días del evento: nada que deje DOMS o fatiga alta.
- Fuerza pre-competencia: neural, estable y corta; nunca pesada pegada al evento.
${hasRunning ? '- Running competitivo: Z2 corto o activación; evita tempo/intervalos cerca del evento.' : ''}
- El deporte accesorio no debe quitar frescura a la sesión objetivo.
- Un control no compite por prioridad con un match o competitive; úsalo como activación o ajuste técnico.${playsSquash ? '\n- Squash pre-partido: control técnico, precisión, la T y activación de pies; evita RSA o carga alta.' : ''}`
}
