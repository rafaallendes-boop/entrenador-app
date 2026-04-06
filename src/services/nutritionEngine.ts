import type { Session, DayLoadType, NutritionRec, AthleteProfile } from '../types'

// ─── Load classifier ──────────────────────────────────────────────────────────

export function classifyDayLoad(sessions: Session[]): DayLoadType {
  const active = sessions.filter(s => s.status !== 'skipped')
  if (active.length === 0) return 'rest'

  const hasMatch = active.some(s => s.subtype === 'match' || s.subtype === 'competitive')
  if (hasMatch) return 'match'

  const hasLongRun = active.some(
    s => (s.type === 'running' || s.type === 'cycling') && s.runningDetails?.runningType === 'long'
  )
  if (hasLongRun) return 'long_run'

  const isDouble = active.length >= 2
  if (isDouble) return 'double'

  const totalMin = active.reduce((a, s) => a + s.durationMin, 0)
  const avgRpe = active.filter(s => s.rpe).reduce((a, s) => a + (s.rpe ?? 5), 0) / active.filter(s => s.rpe).length || 5

  if (totalMin >= 75 || avgRpe >= 7.5) return 'high'
  if (totalMin >= 35 || avgRpe >= 5) return 'medium'
  return 'light'
}

// ─── Nutrition recommendations by load type ───────────────────────────────────

const RECS: Record<DayLoadType, NutritionRec> = {
  rest: {
    loadType: 'rest',
    dailyFocus: 'Día de descanso — prioriza recuperación y proteína',
    hydration: '2L agua. Sin necesidad de bebidas deportivas.',
    breakfast: 'Avena con frutos rojos + 2 huevos revueltos + café',
    lunch: 'Pollo al horno + ensalada completa + 1 fruta',
    snack: 'Yogur griego con nueces',
    dinner: 'Salmón o carne magra + verduras salteadas + arroz pequeño',
  },
  light: {
    loadType: 'light',
    dailyFocus: 'Carga ligera — balance moderado, proteína alta',
    hydration: '2–2.5L agua',
    breakfast: 'Tostadas integrales con palta y huevo + jugo natural',
    lunch: 'Arroz + proteína magra + ensalada fresca',
    snack: 'Puñado de frutos secos + plátano',
    dinner: 'Legumbres con verduras + proteína moderada',
    preTraining: 'Plátano 30–45min antes si entrenas en ayunas',
    postTraining: 'Yogur griego o batido proteico + fruta',
  },
  medium: {
    loadType: 'medium',
    dailyFocus: 'Carga media — carbohidratos moderados, proteína constante',
    hydration: '2.5L agua + electrolitos si sudas mucho',
    preWorkout: 'Tostada con miel o arroz integral 2h antes',
    postWorkout: 'Proteína 20–25g + carbohidrato simple en los primeros 30min',
    breakfast: 'Avena + plátano + huevos + café con leche',
    lunch: 'Arroz integral o pasta + pollo/atún + ensalada',
    snack: 'Fruta + yogur griego o queso cottage',
    dinner: 'Carne/pescado magro + batata o quinoa + verduras',
    preTraining: 'Fruta o tostada con mantequilla de maní 1h antes',
    postTraining: 'Batido de proteína + plátano o arroz con huevo',
  },
  high: {
    loadType: 'high',
    dailyFocus: 'Alta carga — carbohidratos arriba, proteína alta, no escatimes',
    hydration: '3L agua + bebida isotónica durante entrenamiento',
    preWorkout: 'Arroz o pasta + proteína magra 2–2.5h antes. Nada pesado 1h antes.',
    postWorkout: 'En los primeros 30min: 30–40g proteína + 60–80g carbohidratos simples',
    breakfast: 'Avena grande + plátano + 3 huevos + tostadas + café',
    lunch: 'Pasta o arroz abundante + proteína (150–180g) + verduras',
    snack: 'Plátano + batido proteico o sándwich integral con pavo',
    dinner: 'Salmón o carne + patata o quinoa + ensalada completa',
    preTraining: 'Arroz blanco + fuente de proteína o fruta + carbohidrato 1.5h antes',
    postTraining: 'Batido con proteína + carbohidrato (banana, arroz, galletas de arroz)',
  },
  double: {
    loadType: 'double',
    dailyFocus: 'Doble sesión — máxima prioridad a carbohidratos y recuperación entre sesiones',
    hydration: '3–3.5L agua + isotónica entre sesiones',
    preWorkout: 'Carbohidratos 2h antes de la primera sesión. Recarga entre sesiones obligatoria.',
    postWorkout: 'Inmediatamente post sesión: carbos simples + proteína. Repite entre sesiones.',
    breakfast: 'Avena + plátano + 3 huevos + tostadas. Abundante.',
    lunch: 'Entre sesiones: arroz + proteína ligera + fruta. No excederse.',
    snack: 'Plátano + bebida de recuperación o batido entre sesiones',
    dinner: 'Cena completa: proteína + carbohidrato complejo + verduras + fruta',
    preTraining: 'Sesión 1: carbos 2h antes. Sesión 2: recarga con carbos simples (plátano, dátiles)',
    postTraining: 'Sesión 2: proteína + carbos dentro de los 20min. Luego cena completa.',
  },
  match: {
    loadType: 'match',
    dailyFocus: 'Día de partido — estrategia de combustible específica',
    hydration: '3L hoy. Empieza hidratación desde la mañana. Evita cafeína en exceso.',
    preWorkout: '2.5–3h antes: arroz o pasta con proteína magra, sin fibra excesiva. 30min antes: gel o plátano.',
    postWorkout: 'Post partido: proteína + carbohidrato en 30min aunque no tengas hambre. Rehidratación con sales.',
    breakfast: 'Avena + plátano + huevos revueltos. Café permitido. Desayuno 3–4h antes del match.',
    lunch: 'Pre-partido: arroz blanco + pollo o pavo. Sin ensaladas crudas ni legumbres.',
    snack: 'Plátano + dátiles o gel durante calentamiento si el partido es tarde',
    dinner: 'Post partido: cena de recuperación completa — proteína + carbos + verduras cocidas',
    preTraining: 'Protocolo: carbohidratos de fácil digestión las 24h previas. Evitar nuevos alimentos.',
    postTraining: 'Batido proteico + banana o sándwich en los primeros 30min post partido',
  },
  long_run: {
    loadType: 'long_run',
    dailyFocus: 'Long run — carga de carbohidratos moderada, hidratación clave',
    hydration: '3L agua. Lleva agua o gel en la carrera si dura >60min.',
    preWorkout: '2h antes: avena + plátano. 30min antes: nada sólido. Gel si dura >75min.',
    postWorkout: 'En 30min post: carbos simples + proteína (batido o comida). Crítico para recuperación.',
    breakfast: 'Avena + plátano + miel + café. Sin nada nuevo antes de la carrera.',
    lunch: 'Post rodaje: arroz o pasta + proteína + verduras cocidas',
    snack: 'Dátiles o gel durante el rodaje si supera 60min',
    dinner: 'Comida equilibrada y completa — no saltearse la cena tras long run',
    preTraining: 'Carga carbos la noche anterior: arroz o pasta en cena. Desayuno 2h antes.',
    postTraining: 'Ventana anabólica 30min: batido o plátano + proteína. Luego almuerzo completo.',
  },
}

// ─── Personalization helpers ──────────────────────────────────────────────────

/**
 * Protein factor (g/kg of bodyweight) per load type.
 * Higher load → more protein for repair and adaptation.
 */
const PROTEIN_FACTOR: Record<DayLoadType, number> = {
  rest:     1.6,
  light:    1.7,
  medium:   1.8,
  high:     2.0,
  double:   2.0,
  match:    1.9,
  long_run: 1.8,
}

/**
 * Additional water (liters) to add on top of the base daily intake,
 * depending on training load.
 */
const TRAINING_WATER_ADD: Record<DayLoadType, number> = {
  rest:     0,
  light:    0.5,
  medium:   0.75,
  high:     1.0,
  double:   1.5,
  match:    1.5,
  long_run: 1.5,
}

function round05(n: number): number {
  return Math.round(n * 2) / 2
}

function personalizeRec(base: NutritionRec, profile: AthleteProfile | null | undefined): NutritionRec {
  if (!profile) return base

  const weightKg = profile.weightKg
  const np = profile.nutritionProfile
  const rec: NutritionRec = { ...base }

  // ── Protein target ────────────────────────────────────────────────────────
  if (np?.proteinTargetG) {
    rec.proteinTarget = `~${np.proteinTargetG}g proteína`
  } else if (weightKg) {
    const factor = PROTEIN_FACTOR[base.loadType]
    const grams = Math.round(weightKg * factor)
    rec.proteinTarget = `~${grams}g proteína`
  }

  // ── Hydration ─────────────────────────────────────────────────────────────
  // Base: user-defined daily water target or weight-derived (33 ml/kg)
  const waterBase = np?.dailyWaterLiters ?? (weightKg ? round05(weightKg * 0.033) : null)
  const waterAdd = TRAINING_WATER_ADD[base.loadType]

  if (waterBase !== null) {
    const total = round05(waterBase + waterAdd)
    if (waterAdd > 0) {
      rec.hydration = `${waterBase.toFixed(1)}L base + ${waterAdd.toFixed(1)}L entrenamiento = ~${total.toFixed(1)}L hoy. ${base.loadType === 'match' || base.loadType === 'double' ? 'Agrega electrolitos.' : base.loadType === 'high' || base.loadType === 'long_run' ? 'Electrolitos si sudas mucho.' : ''}`
    } else {
      rec.hydration = `~${total.toFixed(1)}L hoy (día sin entrenamiento).`
    }
    rec.hydration = rec.hydration.trim()
  }

  // ── Dietary notes ─────────────────────────────────────────────────────────
  if (np?.notes?.trim()) {
    rec.dietaryNotes = np.notes.trim()
  }

  return rec
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getDayNutrition(sessions: Session[], profile?: AthleteProfile | null): NutritionRec {
  const loadType = classifyDayLoad(sessions)
  return personalizeRec(RECS[loadType], profile)
}

export function getLoadTypeLabel(loadType: DayLoadType): string {
  const labels: Record<DayLoadType, string> = {
    rest:     'Descanso',
    light:    'Carga ligera',
    medium:   'Carga media',
    high:     'Alta carga',
    double:   'Doble sesión',
    match:    'Día de partido',
    long_run: 'Long run',
  }
  return labels[loadType]
}

export function getLoadTypeColor(loadType: DayLoadType): string {
  const colors: Record<DayLoadType, string> = {
    rest:     'text-teal-400 bg-teal-500/10 border-teal-500/20',
    light:    'text-sky-400 bg-sky-500/10 border-sky-500/20',
    medium:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    high:     'text-orange-400 bg-orange-500/10 border-orange-500/20',
    double:   'text-red-400 bg-red-500/10 border-red-500/20',
    match:    'text-brand-light bg-brand/10 border-brand/20',
    long_run: 'text-lime-400 bg-lime-500/10 border-lime-500/20',
  }
  return colors[loadType]
}
