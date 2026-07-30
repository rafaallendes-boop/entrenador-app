import type { SupportedSport } from '../../../../../types'

export interface WeekCreatorSquashRulesInput {
  allowedSports: SupportedSport[]
  primarySport?: SupportedSport
}

export function buildWeekCreatorSquashRules(input: WeekCreatorSquashRulesInput): string {
  if (!input.allowedSports.includes('squash') && input.primarySport !== 'squash') return ''
  return [
    'Reglas de contenido para sesiones squash:',
    '- Sesión solo técnica: usa sessionKind="technical" y entrega al menos 4 drills técnicos concretos.',
    '- Sesión mixta técnica + juego: usa sessionKind="mixed", blocks[] y drills[] plano; incluye 2 drills técnicos, 2 juegos condicionados y un bloque match/game corto cuando corresponda.',
    '- Sesión mixta ghosting + control: usa sessionKind="mixed", blocks[] y drills[] plano; incluye 2 drills de ghosting y 2-3 drills de control.',
    '- Match-play dedicado: usa sessionKind="match" y un solo bloque match con un único drill "Partido de entrenamiento al mejor de 5 juegos". Es un partido completo, sin Game a 11 adicional, mejor de 3 ni partido condicionado.',
    '- No dejes una sesión squash con solo 1-2 drills salvo que sea partido competitivo real o activación pre-partido muy corta.',
  ].join('\n')
}
