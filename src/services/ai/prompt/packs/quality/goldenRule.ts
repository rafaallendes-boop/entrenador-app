export interface GoldenRuleInput {
  hasRunning: boolean
  hasStrength: boolean
}

export function buildGoldenRuleSection(input: GoldenRuleInput): string {
  return `REGLA DE ORO PARA AJUSTAR UNA SEMANA YA EXISTENTE:
- Si el usuario pide subir una disciplina y bajar otra, primero modifica, mueve o elimina sesiones existentes; solo usa add_session cuando de verdad quieres aumentar el total semanal.
${input.hasRunning || input.hasStrength ? '- Si cambias una sesión entre disciplinas permitidas, debes reemplazar el contenido incompatible anterior; no dejes ejercicios o detalles viejos mezclados.' : ''}`
}
