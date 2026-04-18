import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NutritionFocusCard from './NutritionFocusCard'
import type { NutritionRec } from '../../types'

function makeRec(overrides: Partial<NutritionRec> = {}): NutritionRec {
  return {
    loadType: 'moderate',
    dayType: 'moderate',
    sport: 'running',
    sessionCount: 1,
    mainFocus: 'Carga moderada: acompaña la sesión con carbohidratos útiles y proteína constante.',
    keyAction: 'Prioriza carbohidratos fáciles de digerir 60-120min antes.',
    whyItMatters: 'Ajustar el día al contexto evita recomendaciones genéricas y mejora consistencia.',
    macroEmphasis: 'carb_support',
    hydrationGuidance: {
      totalLiters: 3.3,
      baselineLiters: 2.5,
      trainingAddLiters: 0.8,
      electrolyteFocus: 'optional',
      summary: '2.5L base + 0.8L por carga = ~3.3L hoy.',
    },
    mealTiming: [
      {
        label: 'Pre-entreno',
        timing: 'pre',
        window: '60-120min antes',
        summary: 'Prioriza carbohidratos fáciles de digerir 60-120min antes.',
      },
    ],
    preWorkoutGuidance: {
      label: 'Pre-entreno',
      timing: 'pre',
      window: '60-120min antes',
      summary: 'Prioriza carbohidratos fáciles de digerir 60-120min antes.',
    },
    reasoning: {
      summary: '1 sesión · deporte base: running · carga aeróbica/controlada',
      factors: ['1 sesión'],
    },
    dailyFocus: 'Carga moderada: acompaña la sesión con carbohidratos útiles y proteína constante.',
    hydration: '2.5L base + 0.8L por carga = ~3.3L hoy.',
    preWorkout: 'Prioriza carbohidratos fáciles de digerir 60-120min antes.',
    proteinTarget: '~144g proteína',
    ...overrides,
  }
}

describe('NutritionFocusCard', () => {
  it('renders the new focus, action, and reason summary', () => {
    const html = renderToStaticMarkup(<NutritionFocusCard rec={makeRec()} />)

    expect(html).toContain('Nutrición hoy')
    expect(html).toContain('Carga moderada')
    expect(html).toContain('Prioriza carbohidratos fáciles de digerir')
    expect(html).toContain('objetivo del día')
  })
})
