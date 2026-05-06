import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import PlanBuilderLaunchDeck from '../components/planBuilder/PlanBuilderLaunchDeck'
import Card from '../components/ui/Card'
import { ROUTES } from '../constants/routes'
import { db } from '../db/db'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { usePlanBuilderStore } from '../store/usePlanBuilderStore'
import { getPrimaryGoalEvent } from '../services/macroPlan'
import { ChevronLeft, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { PlanWizardConfig, GoalEvent } from '../types'
import type { TrainingPlanWeek } from '../types/planBuilder'

const PHASE_LABELS: Record<string, string> = {
  base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race: 'Race', transition: 'Transition',
}

const PHASE_DOT: Record<string, string> = {
  base: 'bg-sky-400',
  build: 'bg-amber-400',
  peak: 'bg-brand',
  taper: 'bg-emerald-400',
  race: 'bg-rose-400',
  transition: 'bg-ink-faint',
}

function buildGenerationSignals(week: TrainingPlanWeek): string[] {
  const signals: string[] = []
  const meta = week.generationMeta

  if (meta.requestClass) {
    signals.push(meta.requestClass === 'plan_builder_pair' ? 'Batch par' : 'Semana individual')
  }
  if (meta.validSessionCount != null && meta.rawSessionCount != null && meta.rawSessionCount > meta.validSessionCount) {
    signals.push(`Sesiones válidas ${meta.validSessionCount}/${meta.rawSessionCount}`)
  }
  if ((meta.droppedSessionCount ?? 0) > 0) {
    signals.push(`${meta.droppedSessionCount} descartada${meta.droppedSessionCount === 1 ? '' : 's'} por formato`)
  }
  if (meta.degradedFromPairs) {
    signals.push('Batch degradado a generación individual')
  }
  if ((meta.attempts ?? 0) > 1) {
    signals.push(`${meta.attempts} intentos`)
  }
  if (meta.retryUsed) {
    signals.push('Retry técnico aplicado')
  }
  if (meta.fallbackUsed) {
    signals.push('Fallback de provider')
  }

  return signals
}

function getWeekGenerationStatus(week: TrainingPlanWeek): string {
  if (week.status === 'error') return 'error final'
  if (week.status === 'generating' && (week.generationMeta.attempts ?? 0) >= 2) {
    const lastError = week.generationMeta.lastError?.toLowerCase() ?? ''
    if (lastError.includes('formato') || lastError.includes('targetdate') || lastError.includes('válidas')) {
      return 'corrigiendo formato'
    }
    return 'reintentando por validación'
  }
  if (week.status === 'generating') return 'generando'
  return 'lista'
}


function SquashPlayerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 230" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <defs>
        <linearGradient id="sqPG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff8040" />
          <stop offset="100%" stopColor="#cc3200" />
        </linearGradient>
        <radialGradient id="sqHalo" cx="44%" cy="50%" r="52%">
          <stop offset="0%" stopColor="#ff4d00" stopOpacity="0.38" />
          <stop offset="60%" stopColor="#ff4d00" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#ff4d00" stopOpacity="0" />
        </radialGradient>
        <filter id="sqGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="sqSoftGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Atmospheric halo */}
      <ellipse cx="90" cy="118" rx="94" ry="86" fill="url(#sqHalo)" />

      {/* Court floor — service box perspective */}
      <line x1="6" y1="220" x2="194" y2="220" stroke="rgba(255,77,0,0.20)" strokeWidth="1" />
      <path d="M6,220 L95,150 L194,220" stroke="rgba(255,77,0,0.11)" strokeWidth="0.9" fill="none" />
      <path d="M32,220 L95,166 L162,220" stroke="rgba(255,77,0,0.07)" strokeWidth="0.7" fill="none" />
      <line x1="66" y1="150" x2="124" y2="150" stroke="rgba(255,77,0,0.13)" strokeWidth="0.9" />
      <line x1="55" y1="163" x2="138" y2="163" stroke="rgba(255,77,0,0.08)" strokeWidth="0.6" />

      {/* Head */}
      <circle cx="76" cy="42" r="13" fill="url(#sqPG)" filter="url(#sqGlow)" />

      {/* Neck */}
      <rect x="72" y="54" width="8" height="7" rx="3" fill="url(#sqPG)" />

      {/* Torso — rotated slightly for forehand swing */}
      <path d="M66,61 C62,74 60,88 62,104 L85,101 C87,86 90,72 92,60 Z" fill="url(#sqPG)" />

      {/* Left arm — high balance reach */}
      <path d="M68,68 C58,57 47,46 35,37" stroke="url(#sqPG)" strokeWidth="12" strokeLinecap="round" fill="none" filter="url(#sqGlow)" />
      {/* Left hand open */}
      <circle cx="33" cy="35" r="5" fill="url(#sqPG)" />

      {/* Right arm — aggressive forehand swing, arm fully extended */}
      <path d="M88,64 C100,78 114,94 126,112" stroke="url(#sqPG)" strokeWidth="12" strokeLinecap="round" fill="none" filter="url(#sqGlow)" />
      <path d="M126,112 C132,124 138,136 144,148" stroke="url(#sqPG)" strokeWidth="9" strokeLinecap="round" fill="none" />

      {/* Left leg — deep forward lunge, knee fully bent */}
      <path d="M64,101 C58,116 50,133 40,152 L53,156 C61,137 68,120 75,103 Z" fill="url(#sqPG)" />
      <path d="M40,152 C36,165 32,179 30,192 L43,195 C46,182 50,168 53,156 Z" fill="url(#sqPG)" />
      {/* Left foot flat on court */}
      <path d="M26,195 L44,193 L43,202 L22,204 Z" fill="url(#sqPG)" />

      {/* Right leg — power base, extended back */}
      <path d="M80,101 C87,116 97,132 107,148 L117,143 C107,127 97,111 89,97 Z" fill="url(#sqPG)" />
      <path d="M107,148 C114,162 120,174 124,187 L134,183 C130,170 124,157 117,143 Z" fill="url(#sqPG)" />
      {/* Right foot — tiptoe on back leg */}
      <path d="M123,190 L135,183 L139,191 L126,198 Z" fill="url(#sqPG)" />

      {/* Racket grip */}
      <line x1="144" y1="148" x2="158" y2="168" stroke="#ff8a50" strokeWidth="7" strokeLinecap="round" />

      {/* Racket head — larger, rotated, full forehand contact position */}
      <ellipse cx="172" cy="183" rx="27" ry="21" stroke="#ff7a33" strokeWidth="3.0" fill="rgba(255,77,0,0.09)" transform="rotate(-32 172 183)" filter="url(#sqGlow)" />

      {/* String mesh — denser */}
      <line x1="155" y1="171" x2="182" y2="195" stroke="rgba(255,130,60,0.30)" strokeWidth="0.9" />
      <line x1="160" y1="166" x2="184" y2="188" stroke="rgba(255,130,60,0.22)" strokeWidth="0.8" />
      <line x1="151" y1="177" x2="177" y2="200" stroke="rgba(255,130,60,0.22)" strokeWidth="0.8" />
      <line x1="148" y1="183" x2="180" y2="170" stroke="rgba(255,130,60,0.24)" strokeWidth="0.8" />
      <line x1="150" y1="176" x2="183" y2="163" stroke="rgba(255,130,60,0.19)" strokeWidth="0.7" />
      <line x1="152" y1="169" x2="180" y2="158" stroke="rgba(255,130,60,0.15)" strokeWidth="0.6" />
      <line x1="147" y1="190" x2="178" y2="177" stroke="rgba(255,130,60,0.16)" strokeWidth="0.6" />

      {/* Ball — mid-air, about to be struck */}
      <circle cx="46" cy="168" r="6" fill="#ff8040" filter="url(#sqSoftGlow)" />
      <circle cx="46" cy="168" r="11" fill="none" stroke="#ff6020" strokeWidth="0.9" opacity="0.40" />
      {/* Ball trail */}
      <line x1="39" y1="168" x2="18" y2="165" stroke="rgba(255,110,40,0.50)" strokeWidth="2.0" strokeLinecap="round" strokeDasharray="2,3" />
      <line x1="38" y1="164" x2="22" y2="160" stroke="rgba(255,110,40,0.25)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2,4" />
      <line x1="38" y1="172" x2="24" y2="175" stroke="rgba(255,110,40,0.18)" strokeWidth="1.0" strokeLinecap="round" strokeDasharray="2,5" />

      {/* Racket swing arc */}
      <path d="M108,96 C116,100 124,108 130,118" stroke="rgba(255,77,0,0.22)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="3,4" fill="none" />

      {/* Speed lines near racket */}
      <line x1="132" y1="115" x2="112" y2="114" stroke="rgba(255,77,0,0.32)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="134" y1="123" x2="116" y2="125" stroke="rgba(255,77,0,0.22)" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="130" y1="107" x2="113" y2="104" stroke="rgba(255,77,0,0.16)" strokeWidth="0.9" strokeLinecap="round" />

      {/* Impact burst at ball contact point */}
      <circle cx="144" cy="152" r="4" fill="#ffaa66" opacity="0.70" filter="url(#sqGlow)" />
      <line x1="138" y1="146" x2="131" y2="140" stroke="#ff8040" strokeWidth="1.8" strokeLinecap="round" opacity="0.60" />
      <line x1="144" y1="145" x2="144" y2="137" stroke="#ff8040" strokeWidth="1.8" strokeLinecap="round" opacity="0.50" />
      <line x1="150" y1="146" x2="157" y2="140" stroke="#ff8040" strokeWidth="1.8" strokeLinecap="round" opacity="0.50" />
      <line x1="152" y1="153" x2="160" y2="156" stroke="#ff8040" strokeWidth="1.4" strokeLinecap="round" opacity="0.38" />
      <line x1="137" y1="153" x2="129" y2="157" stroke="#ff8040" strokeWidth="1.4" strokeLinecap="round" opacity="0.35" />
    </svg>
  )
}

function RunnerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 230" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <defs>
        <linearGradient id="runPG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff8040" />
          <stop offset="100%" stopColor="#cc3200" />
        </linearGradient>
        <radialGradient id="runHalo" cx="50%" cy="52%" r="50%">
          <stop offset="0%" stopColor="#ff4d00" stopOpacity="0.34" />
          <stop offset="65%" stopColor="#ff4d00" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ff4d00" stopOpacity="0" />
        </radialGradient>
        <filter id="runGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="runSoftGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Atmospheric halo */}
      <ellipse cx="100" cy="115" rx="90" ry="80" fill="url(#runHalo)" />

      {/* Track — perspective lane lines */}
      <line x1="6" y1="220" x2="194" y2="220" stroke="rgba(255,77,0,0.20)" strokeWidth="1" />
      <path d="M6,220 L100,158 L194,220" stroke="rgba(255,77,0,0.10)" strokeWidth="0.8" fill="none" />
      <path d="M35,220 L100,173 L165,220" stroke="rgba(255,77,0,0.06)" strokeWidth="0.7" fill="none" />
      {/* Lane tick marks */}
      <line x1="52" y1="217" x2="52" y2="222" stroke="rgba(255,77,0,0.24)" strokeWidth="1" />
      <line x1="100" y1="214" x2="100" y2="222" stroke="rgba(255,77,0,0.24)" strokeWidth="1" />
      <line x1="148" y1="217" x2="148" y2="222" stroke="rgba(255,77,0,0.24)" strokeWidth="1" />

      {/* Head — forward lean */}
      <circle cx="108" cy="36" r="13" fill="url(#runPG)" filter="url(#runGlow)" />

      {/* Torso — forward lean ~12 degrees */}
      <path d="M100,49 C98,61 97,74 95,90 L113,92 C113,76 114,63 118,51 Z" fill="url(#runPG)" />

      {/* Left arm — forward pump, elbow bent */}
      <path d="M102,63 C110,55 120,49 130,44" stroke="url(#runPG)" strokeWidth="11" strokeLinecap="round" fill="none" filter="url(#runGlow)" />
      <path d="M130,44 C135,40 138,37 136,32" stroke="url(#runPG)" strokeWidth="8" strokeLinecap="round" fill="none" />

      {/* Right arm — back drive, elbow bent */}
      <path d="M110,63 C100,74 88,84 78,92" stroke="url(#runPG)" strokeWidth="11" strokeLinecap="round" fill="none" filter="url(#runGlow)" />
      <path d="M78,92 C73,97 70,102 72,108" stroke="url(#runPG)" strokeWidth="8" strokeLinecap="round" fill="none" />

      {/* Right leg — stride forward, knee drive up */}
      {/* Thigh forward */}
      <path d="M98,90 C104,104 112,116 120,128 L129,122 C121,110 113,97 106,85 Z" fill="url(#runPG)" />
      {/* Lower leg down, foot contact */}
      <path d="M120,128 C124,140 128,152 130,164 L139,160 C137,148 133,136 129,122 Z" fill="url(#runPG)" />
      {/* Foot strike */}
      <path d="M128,166 L141,159 L145,167 L130,174 Z" fill="url(#runPG)" />
      {/* Foot strike glow */}
      <ellipse cx="136" cy="172" rx="13" ry="5" fill="rgba(255,77,0,0.22)" filter="url(#runSoftGlow)" />

      {/* Left leg — pushoff behind, leg bent back */}
      {/* Thigh back */}
      <path d="M108,90 C101,104 91,116 80,127 L71,120 C81,109 90,97 98,85 Z" fill="url(#runPG)" />
      {/* Lower leg curled up behind */}
      <path d="M71,120 C65,108 63,96 67,85 L76,88 C73,98 74,109 80,121 Z" fill="url(#runPG)" />
      {/* Foot behind — toe up */}
      <path d="M65,84 L76,86 L77,95 L64,94 Z" fill="url(#runPG)" />

      {/* Speed lines — motion blur to the left */}
      <line x1="56" y1="116" x2="34" y2="116" stroke="rgba(255,77,0,0.35)" strokeWidth="2.0" strokeLinecap="round" />
      <line x1="53" y1="125" x2="33" y2="126" stroke="rgba(255,77,0,0.25)" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="59" y1="107" x2="41" y2="106" stroke="rgba(255,77,0,0.20)" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="60" y1="134" x2="44" y2="135" stroke="rgba(255,77,0,0.16)" strokeWidth="0.9" strokeLinecap="round" />

      {/* Sweat droplet */}
      <path d="M116,30 C116,27 119,24 119,28 C119,30.5 117.5,32 116,30 Z" fill="#ffaa66" opacity="0.55" />

      {/* Bib number hint */}
      <rect x="98" y="66" width="15" height="12" rx="1.5" fill="rgba(255,255,255,0.10)" stroke="rgba(255,130,60,0.22)" strokeWidth="0.7" />
    </svg>
  )
}

function CyclistMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 230" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <defs>
        <linearGradient id="cycPG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff8040" />
          <stop offset="100%" stopColor="#cc3200" />
        </linearGradient>
        <radialGradient id="cycHalo" cx="50%" cy="54%" r="50%">
          <stop offset="0%" stopColor="#ff4d00" stopOpacity="0.30" />
          <stop offset="65%" stopColor="#ff4d00" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ff4d00" stopOpacity="0" />
        </radialGradient>
        <filter id="cycGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Atmospheric halo */}
      <ellipse cx="102" cy="128" rx="88" ry="78" fill="url(#cycHalo)" />

      {/* Road — perspective */}
      <line x1="6" y1="220" x2="194" y2="220" stroke="rgba(255,77,0,0.20)" strokeWidth="1" />
      <path d="M6,220 L102,168 L194,220" stroke="rgba(255,77,0,0.09)" strokeWidth="0.8" fill="none" />
      {/* Road center dashes */}
      <line x1="90" y1="214" x2="100" y2="207" stroke="rgba(255,77,0,0.22)" strokeWidth="1.2" strokeDasharray="4,6" />
      <line x1="100" y1="207" x2="110" y2="200" stroke="rgba(255,77,0,0.14)" strokeWidth="1.0" strokeDasharray="3,6" />

      {/* Rear wheel */}
      <circle cx="56" cy="168" r="42" stroke="#ff7a33" strokeWidth="2.8" fill="rgba(255,77,0,0.05)" filter="url(#cycGlow)" />
      <circle cx="56" cy="168" r="7" fill="url(#cycPG)" />
      {/* Rear spokes */}
      <line x1="56" y1="126" x2="56" y2="210" stroke="rgba(255,100,40,0.28)" strokeWidth="1" />
      <line x1="14" y1="155" x2="98" y2="181" stroke="rgba(255,100,40,0.22)" strokeWidth="1" />
      <line x1="14" y1="181" x2="98" y2="155" stroke="rgba(255,100,40,0.22)" strokeWidth="1" />
      <line x1="28" y1="136" x2="84" y2="200" stroke="rgba(255,100,40,0.16)" strokeWidth="0.8" />
      <line x1="28" y1="200" x2="84" y2="136" stroke="rgba(255,100,40,0.16)" strokeWidth="0.8" />

      {/* Front wheel */}
      <circle cx="150" cy="168" r="42" stroke="#ff7a33" strokeWidth="2.8" fill="rgba(255,77,0,0.05)" filter="url(#cycGlow)" />
      <circle cx="150" cy="168" r="7" fill="url(#cycPG)" />
      {/* Front spokes */}
      <line x1="150" y1="126" x2="150" y2="210" stroke="rgba(255,100,40,0.28)" strokeWidth="1" />
      <line x1="108" y1="155" x2="192" y2="181" stroke="rgba(255,100,40,0.22)" strokeWidth="1" />
      <line x1="108" y1="181" x2="192" y2="155" stroke="rgba(255,100,40,0.22)" strokeWidth="1" />
      <line x1="122" y1="136" x2="178" y2="200" stroke="rgba(255,100,40,0.16)" strokeWidth="0.8" />
      <line x1="122" y1="200" x2="178" y2="136" stroke="rgba(255,100,40,0.16)" strokeWidth="0.8" />

      {/* Bike frame */}
      {/* Seat tube */}
      <line x1="102" y1="168" x2="84" y2="118" stroke="url(#cycPG)" strokeWidth="5.5" strokeLinecap="round" />
      {/* Top tube */}
      <line x1="86" y1="114" x2="138" y2="106" stroke="url(#cycPG)" strokeWidth="4.5" strokeLinecap="round" />
      {/* Down tube */}
      <line x1="140" y1="108" x2="102" y2="168" stroke="url(#cycPG)" strokeWidth="5.5" strokeLinecap="round" />
      {/* Chain stays */}
      <line x1="102" y1="168" x2="56" y2="168" stroke="url(#cycPG)" strokeWidth="4" strokeLinecap="round" />
      {/* Seat stays */}
      <line x1="84" y1="118" x2="56" y2="168" stroke="url(#cycPG)" strokeWidth="3" strokeLinecap="round" />
      {/* Fork */}
      <line x1="140" y1="108" x2="150" y2="168" stroke="url(#cycPG)" strokeWidth="4.5" strokeLinecap="round" />

      {/* Saddle */}
      <rect x="74" y="107" width="28" height="6" rx="3" fill="url(#cycPG)" />

      {/* Drops handlebars */}
      <path d="M138,106 L146,96 C148,92 152,92 154,96 L157,106" stroke="url(#cycPG)" strokeWidth="4.5" strokeLinecap="round" fill="none" />

      {/* Rider — aggressive aero tuck */}
      {/* Back / torso — near horizontal */}
      <path d="M84,112 C92,102 110,94 132,88 C137,86 141,88 142,93 C143,98 140,102 135,104 C114,110 100,118 92,128 C88,132 82,130 80,123 Z" fill="url(#cycPG)" />

      {/* Head — low aero helmet, chin forward */}
      <ellipse cx="146" cy="80" rx="14" ry="11" fill="url(#cycPG)" filter="url(#cycGlow)" />
      {/* Aero helmet tail */}
      <path d="M133,74 C128,76 126,80 130,83 C134,86 140,84 146,80" fill="url(#cycPG)" opacity="0.75" />

      {/* Arm on drops */}
      <path d="M134,103 C137,108 139,113 138,118 C137,122 134,123 131,120 C127,116 124,110 124,103" stroke="url(#cycPG)" strokeWidth="10" strokeLinecap="round" fill="none" />

      {/* Left leg — down, power stroke */}
      <path d="M88,125 C82,139 74,154 68,168 L79,172 C85,158 93,143 100,128 Z" fill="url(#cycPG)" />
      {/* Left foot / shoe on pedal */}
      <path d="M63,170 L80,168 L81,176 L62,178 Z" fill="url(#cycPG)" />

      {/* Right leg — up, recovery stroke */}
      <path d="M98,126 C107,116 116,112 122,118 L113,128 C109,121 105,124 99,132 Z" fill="url(#cycPG)" />
      {/* Right foot on top pedal */}
      <path d="M103,168 L122,165 L124,172 L104,175 Z" fill="url(#cycPG)" />

      {/* Speed lines */}
      <line x1="16" y1="142" x2="2" y2="142" stroke="rgba(255,77,0,0.34)" strokeWidth="2.0" strokeLinecap="round" />
      <line x1="18" y1="153" x2="5" y2="154" stroke="rgba(255,77,0,0.24)" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="20" y1="163" x2="9" y2="165" stroke="rgba(255,77,0,0.18)" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="15" y1="132" x2="4" y2="130" stroke="rgba(255,77,0,0.15)" strokeWidth="0.9" strokeLinecap="round" />

      {/* Chain */}
      <ellipse cx="102" cy="168" rx="12" ry="8" stroke="rgba(255,100,40,0.30)" strokeWidth="1" fill="none" strokeDasharray="3,2" />
    </svg>
  )
}

function getSportFromGoalEvent(goalEvent: GoalEvent | undefined): 'squash' | 'running' | 'cycling' | 'other' {
  if (!goalEvent) return 'other'
  const eventType = goalEvent.eventType
  if (eventType === 'other') return 'other'
  if (eventType === 'race') return 'running'
  if (eventType === 'cycling_event') return 'cycling'
  if (eventType === 'tournament') return 'squash'
  const sport = (goalEvent.sport ?? '').toLowerCase()
  if (sport.includes('squash')) return 'squash'
  if (sport.includes('run')) return 'running'
  if (sport.includes('cycl') || sport.includes('bike')) return 'cycling'
  return 'other'
}

function SportAthleteIllustration({ goalEvent, className }: { goalEvent: GoalEvent | undefined; className?: string }) {
  const sport = getSportFromGoalEvent(goalEvent)
  if (sport === 'running') return <RunnerMark className={className} />
  if (sport === 'cycling') return <CyclistMark className={className} />
  if (sport === 'squash') return <SquashPlayerMark className={className} />
  return null
}

function buildDraftSignature(goalEventId: string, wizardConfig: PlanWizardConfig): string {
  return JSON.stringify({
    goalEventId,
    wizardConfig,
  })
}

export default function PlanBuilderV2Page() {
  const navigate = useNavigate()
  const location = useLocation()
  const athleteProfile = useCoachMemoryStore((s) => s.athleteProfile)
  const hasLoaded = useCoachMemoryStore((s) => s.hasLoaded)
  const loadMemory = useCoachMemoryStore((s) => s.loadMemory)
  const {
    plan, weeks, issues, status, currentWeekIndex, completedWeeks, failedWeekIndexes, streamingTextByWeekIndex, lastError,
    createDraft, runGeneration, retryFullGeneration, regenerateWeek, acceptPlan, discard, loadDraft,
  } = usePlanBuilderStore()

  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null)
  const [initializedPlanId, setInitializedPlanId] = useState<string | null>(null)
  // Tracks the draft signature for which we have already kicked off load/createDraft
  // during this mount. Prevents the effect from firing a second async cycle while
  // the first one is still in flight (which can otherwise produce duplicate draft
  // creation when location.state propagates through redirects).
  const inflightSignatureRef = useRef<string | null>(null)

  const goalEvent = getPrimaryGoalEvent(athleteProfile)
  const expectedDraftSignature = athleteProfile?.planWizardConfig && goalEvent
    ? buildDraftSignature(goalEvent.id, athleteProfile.planWizardConfig)
    : null
  const currentDraftSignature = plan
    ? buildDraftSignature(plan.goalEventId, plan.wizardConfig)
    : null

  // Consume any location.state coming from the chat redirect once. Without this,
  // re-renders that re-evaluate the state object can keep retriggering downstream
  // effects that key off "fromChatRedirect".
  useEffect(() => {
    if (!location.state) return
    navigate(location.pathname, { replace: true, state: null })
    // We intentionally only run this on first mount when state is present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (hasLoaded) return
    void loadMemory()
  }, [hasLoaded, loadMemory])

  useEffect(() => {
    if (!athleteProfile || !athleteProfile.planWizardConfig || !goalEvent) return
    const wizardConfig = athleteProfile.planWizardConfig
    if (currentDraftSignature === expectedDraftSignature) {
      inflightSignatureRef.current = null
      return
    }
    if (expectedDraftSignature && inflightSignatureRef.current === expectedDraftSignature) {
      // We already kicked off a draft for this signature; wait for it to settle.
      return
    }
    inflightSignatureRef.current = expectedDraftSignature
    if (plan) {
      void createDraft({ profile: athleteProfile, wizardConfig })
      return
    }

    let cancelled = false
    void (async () => {
      const existingPlans = await db.trainingPlans
        .where('athleteId')
        .equals(athleteProfile.id)
        .toArray()
      if (cancelled) return

      const matchingPlan = existingPlans
        .filter((candidate) => buildDraftSignature(candidate.goalEventId, candidate.wizardConfig) === expectedDraftSignature)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]

      if (matchingPlan) {
        const matchingWeeks = await db.trainingPlanWeeks
          .where('planId')
          .equals(matchingPlan.id)
          .toArray()
        if (cancelled) return
        if (matchingWeeks.length > 0) {
          await loadDraft(matchingPlan.id)
          return
        }
        if (matchingPlan.status === 'draft') {
          await db.trainingPlanWeeks.where('planId').equals(matchingPlan.id).delete()
          await db.trainingPlans.delete(matchingPlan.id)
        }
      }

      await createDraft({ profile: athleteProfile, wizardConfig })
    })()

    return () => {
      cancelled = true
    }
  }, [athleteProfile, createDraft, currentDraftSignature, expectedDraftSignature, goalEvent, loadDraft, plan])

  const effectiveSelectedWeekIndex = (() => {
    // If there are failed weeks and the user hasn't explicitly selected one of them,
    // surface the first failed week automatically (no setState-in-effect needed)
    if (failedWeekIndexes.length > 0 && !(selectedWeekIndex != null && failedWeekIndexes.includes(selectedWeekIndex))) {
      return failedWeekIndexes[0]!
    }
    if (selectedWeekIndex != null && weeks.some((week) => week.weekIndex === selectedWeekIndex)) {
      return selectedWeekIndex
    }
    return weeks[0]?.weekIndex ?? 0
  })()
  const selectedWeek = weeks.find((w) => w.weekIndex === effectiveSelectedWeekIndex)
  const selectedWeekSignals = selectedWeek ? buildGenerationSignals(selectedWeek) : []
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const hasIncompleteWeeks = weeks.length === 0 || weeks.some((week) => week.status !== 'draft' || week.sessions.length === 0)
  const hasFailedWeeks = failedWeekIndexes.length > 0
  const canAcceptPlan = plan?.generationState === 'complete' && !hasIncompleteWeeks && errors.length === 0
  const acceptBlockers = [
    ...(plan?.generationState && plan.generationState !== 'complete' ? ['El plan todavia no esta completamente generado.'] : []),
    ...(hasFailedWeeks ? ['Hay semanas fallidas. Regénéralas para continuar.'] : []),
    ...(!hasFailedWeeks && hasIncompleteWeeks ? ['Completa o regenera todas las semanas antes de aceptar el plan.'] : []),
    ...errors.map((issue) => issue.message),
  ]

  if (!hasLoaded && !athleteProfile) {
    return (
      <div className="px-4 pt-12 pb-8 max-w-md mx-auto">
        <Card className="p-4 space-y-3">
          <h1 className="text-lg font-bold text-ink">Plan Builder</h1>
          <p className="text-sm text-ink-muted">
            Preparando tu perfil antes de construir el plan.
          </p>
        </Card>
      </div>
    )
  }

  if (!athleteProfile?.planWizardConfig || !goalEvent) {
    return (
      <div className="px-4 pt-12 pb-8 max-w-md mx-auto">
        <Card className="p-4 space-y-3">
          <h1 className="text-lg font-bold text-ink">Plan Builder</h1>
          <p className="text-sm text-ink-muted">
            Necesitás completar el wizard de plan de competencia antes de generar un plan por evento.
          </p>
          <button
            onClick={() => navigate(ROUTES.COMPETITION_PLAN)}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Abrir wizard
          </button>
        </Card>
      </div>
    )
  }

  const isGenerating = status === 'generating'
  const generationProgress = weeks.length > 0 ? Math.round((completedWeeks / weeks.length) * 100) : 0
  const currentPlanId = plan?.id ?? null
  const shouldShowLaunchDeck =
    currentPlanId !== null &&
    status === 'shell_ready' &&
    plan?.generationState === 'shell' &&
    weeks.length > 0 &&
    weeks.every((week) => week.status === 'pending') &&
    currentPlanId !== initializedPlanId
  const launchInsight = goalEvent
    ? `Basado en ${goalEvent.title} y en tu configuracion competitiva actual, conviene inicializar un macro-bloque limpio antes de expandir cada semana con el motor de generacion.`
    : 'Hay un blueprint listo para generar. Conviene inicializar el protocolo desde una estructura estable y consistente.'

  async function handleInitializeProtocol() {
    if (!athleteProfile || !plan || isGenerating || status === 'committing') return
    setInitializedPlanId(plan.id)
    await runGeneration(athleteProfile)
  }

  async function handleRetryFailedWeeks() {
    if (!athleteProfile || isGenerating || status === 'committing' || failedWeekIndexes.length === 0) return

    for (const weekIndex of failedWeekIndexes) {
      await regenerateWeek(weekIndex, athleteProfile)
    }
  }

  async function handleRetryFullGeneration() {
    if (!athleteProfile || isGenerating || status === 'committing') return
    await retryFullGeneration(athleteProfile)
  }

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <div className="relative overflow-hidden px-4 pb-5 pt-10 md:px-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Ambient glow */}
        <div className="pointer-events-none absolute left-0 top-0 h-40 w-64 rounded-full bg-brand/8 blur-3xl" />
        {/* Top accent line */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,77,0,0.4), transparent)' }} />
        {/* Sport athlete hero mark — dynamic by goal event sport */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 flex items-center">
          <SportAthleteIllustration
            goalEvent={goalEvent}
            className="h-36 w-auto translate-x-8 opacity-[0.25] sm:h-48 sm:translate-x-6 sm:opacity-[0.35] md:h-64 md:opacity-[0.48]"
          />
        </div>

        <div className="relative max-w-5xl mx-auto">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-4 flex items-center gap-1.5 text-xs font-medium text-ink-faint transition-colors hover:text-ink-muted"
          >
            <ChevronLeft size={14} /> Volver
          </button>

          <div className="flex items-start justify-between gap-4 flex-wrap pr-16 sm:pr-24 md:pr-40">
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.36em] text-ink-faint">
                Plan Builder
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">
                {plan?.title ?? `Plan para ${goalEvent.title}`}
              </h1>
              {plan && (
                <p className="mt-1 text-xs text-ink-muted">
                  {plan.totalWeeks} semanas · Inicio {plan.startDate} · Evento {plan.macroSnapshot.goalEventDate}
                </p>
              )}
              {lastError && (
                <p className="mt-1.5 text-xs text-red-400">{lastError}</p>
              )}
            </div>

            {status === 'done' && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-400"
                style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <CheckCircle2 size={12} /> Plan aceptado
              </span>
            )}
          </div>

          {/* Generation progress bar */}
          {isGenerating && weeks.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-ink-faint">
                  Generando · {completedWeeks}/{weeks.length} semanas
                </span>
                <span className="font-mono text-[9px] font-bold" style={{ color: '#ff7a33' }}>{generationProgress}%</span>
              </div>
              <div className="overflow-hidden rounded-full" style={{ height: '3px', background: 'rgba(255,255,255,0.08)' }}>
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${generationProgress}%`,
                    background: 'linear-gradient(90deg, #ff4d00, #ff7a33)',
                    boxShadow: '0 0 8px 2px rgba(255,77,0,0.55)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main grid */}
      <div className="mx-auto max-w-5xl px-4 pt-5 md:px-6">
        {shouldShowLaunchDeck ? (
          <PlanBuilderLaunchDeck
            title="Plan Builder"
            subtitle="Architect your kinetic framework before the engine expands each week."
            insight={launchInsight}
            weeksLabel={`${plan?.totalWeeks ?? weeks.length} semanas listas para inicializar.`}
            goalLabel={goalEvent ? `Evento objetivo: ${goalEvent.title} · ${goalEvent.date}` : 'Macro-plan listo para generar.'}
            isInitializing={isGenerating}
            sport={getSportFromGoalEvent(goalEvent)}
            onInitialize={() => { void handleInitializeProtocol() }}
          />
        ) : plan && weeks.length === 0 ? (
          <div
            className="rounded-2xl p-5"
            style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.18)' }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-400" />
              <div>
                <h2 className="font-display text-base font-bold text-ink">El shell no tiene semanas</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  El draft guardado quedó incompleto. Descártalo y vuelve a generar el plan desde el wizard.
                </p>
                {lastError && <p className="mt-2 text-xs text-red-400">{lastError}</p>}
              </div>
            </div>
          </div>
        ) : status === 'failed' || plan?.generationState === 'failed' ? (
          <div
            className="rounded-2xl p-5"
            style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.18)' }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-400" />
              <div>
                <h2 className="font-display text-base font-bold text-ink">La generación no produjo semanas válidas</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Puedes reintentar la generación completa o descartar este shell y volver a construirlo desde cero.
                </p>
                {lastError && <p className="mt-2 text-xs text-red-400">{lastError}</p>}
              </div>
            </div>
          </div>
        ) : status === 'error' ? (
          <div
            className="rounded-2xl p-5"
            style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.18)' }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-400" />
              <div>
                <h2 className="font-display text-base font-bold text-ink">Error técnico</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  No se pudo completar la operación del Plan Builder.
                </p>
                {lastError && <p className="mt-2 text-xs text-red-400">{lastError}</p>}
              </div>
            </div>
          </div>
        ) : (
        <>
          {/* Mobile-only horizontal week strip */}
          {weeks.length > 0 && (
            <div className="mb-3 md:hidden">
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
              >
                {weeks.map((w) => {
                  const isActive = w.weekIndex === effectiveSelectedWeekIndex
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setSelectedWeekIndex(w.weekIndex)}
                      className="flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95"
                      style={{
                        background: isActive ? 'rgba(255,77,0,0.14)' : 'rgba(255,255,255,0.05)',
                        border: isActive ? '1px solid rgba(255,77,0,0.30)' : '1px solid rgba(255,255,255,0.08)',
                        color: isActive ? '#ff8040' : '#6e6e73',
                        boxShadow: isActive ? '0 0 12px -4px rgba(255,77,0,0.4)' : 'none',
                      }}
                    >
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${PHASE_DOT[w.phase] ?? 'bg-ink-faint'} ${w.status === 'generating' ? 'animate-pulse' : ''}`} />
                      S{w.weekIndex + 1}
                      {currentWeekIndex === w.weekIndex && isGenerating && (
                        <RefreshCw size={9} className="animate-spin" />
                      )}
                      {w.status === 'error' && <AlertTriangle size={9} className="text-red-400" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

        <div className="grid gap-4 md:grid-cols-[210px_1fr_230px]">

          {/* Timeline sidebar — desktop only */}
          <div
            className="hidden md:block rounded-2xl p-3 max-h-[72vh] overflow-y-auto space-y-0.5"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-ink-faint px-2 py-1 mb-1">
              Semanas
            </p>
            {weeks.map((w) => {
              const isActive = w.weekIndex === effectiveSelectedWeekIndex
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSelectedWeekIndex(w.weekIndex)}
                  className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm transition-all"
                  style={{
                    background: isActive ? 'rgba(255,77,0,0.12)' : 'transparent',
                    border: isActive ? '1px solid rgba(255,77,0,0.22)' : '1px solid transparent',
                  }}
                >
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${PHASE_DOT[w.phase] ?? 'bg-ink-faint'} ${w.status === 'generating' ? 'animate-pulse' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold ${isActive ? 'text-ink' : 'text-ink-muted'}`}>
                      Sem {w.weekIndex + 1}
                    </div>
                    <div className="text-[10px] text-ink-faint truncate">
                      {PHASE_LABELS[w.phase]}
                      {w.sessions.length > 0 && ` · ${w.sessions.length}s`}
                    </div>
                  </div>
                  {currentWeekIndex === w.weekIndex && isGenerating && (
                    <RefreshCw size={11} className="animate-spin text-brand flex-shrink-0" />
                  )}
                  {w.status === 'error' && (
                    <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Detail panel */}
          <div
            className="rounded-2xl p-4 md:max-h-[72vh] md:overflow-y-auto"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {selectedWeek ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${PHASE_DOT[selectedWeek.phase] ?? 'bg-ink-faint'}`} />
                      <h2 className="font-display text-base font-bold text-ink">
                        Semana {selectedWeek.weekIndex + 1} · {PHASE_LABELS[selectedWeek.phase]}
                      </h2>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {selectedWeek.weekStartDate}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isGenerating || status === 'committing'}
                    onClick={() => athleteProfile && regenerateWeek(selectedWeek.weekIndex, athleteProfile)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-muted transition-all hover:text-ink disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    <RefreshCw size={11} className={selectedWeek.status === 'generating' ? 'animate-spin' : ''} />
                    Regenerar
                  </button>
                </div>

                {selectedWeekSignals.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedWeekSignals.map((signal) => (
                      <span
                        key={signal}
                        className="rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-amber-300"
                        style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.18)' }}
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                )}

                {selectedWeek.weekObjectives.length > 0 && (
                  <div className="rounded-xl px-3 py-2.5 text-xs"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-ink-faint mb-1.5">Objetivos</p>
                    <ul className="space-y-1">
                      {selectedWeek.weekObjectives.map((obj, i) => (
                        <li key={i} className="flex items-start gap-2 text-ink-muted">
                          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-brand" />
                          {obj.goal}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedWeek.sessions.length === 0 ? (
                  <div className="py-4 text-center">
                    {selectedWeek.status === 'generating' ? (
                      <>
                        <div className="mb-3 flex justify-center">
                          <RefreshCw size={20} className="animate-spin text-brand" />
                        </div>
                        <p className="text-xs text-ink-muted">{getWeekGenerationStatus(selectedWeek)}…</p>
                        {streamingTextByWeekIndex[selectedWeek.weekIndex] && (
                          <div className="mt-3 rounded-xl px-3 py-2.5 text-left text-xs text-ink-muted whitespace-pre-wrap"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                            {streamingTextByWeekIndex[selectedWeek.weekIndex]}
                          </div>
                        )}
                      </>
                    ) : selectedWeek.status === 'error' ? (
                      <div className="space-y-2">
                        <p className="text-xs text-red-400">
                          Error: {selectedWeek.generationMeta.lastError ?? 'Generación fallida'}
                        </p>
                        {(selectedWeek.generationMeta.validSessionCount != null || selectedWeek.generationMeta.degradedFromPairs) && (
                          <div
                            className="rounded-xl px-3 py-2.5 text-left text-[11px] text-amber-300"
                            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.16)' }}
                          >
                            {selectedWeek.generationMeta.validSessionCount != null && selectedWeek.generationMeta.rawSessionCount != null && (
                              <p>
                                El motor rescató {selectedWeek.generationMeta.validSessionCount} de {selectedWeek.generationMeta.rawSessionCount} sesiones propuestas.
                              </p>
                            )}
                            {selectedWeek.generationMeta.degradedFromPairs && (
                              <p>
                                Se cambió de generación por pares a generación individual para priorizar estabilidad.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-faint">Sin sesiones todavía.</p>
                    )}
                  </div>
                ) : (
                  <>
                    {selectedWeekSignals.length > 0 && (
                      <div
                        className="rounded-xl px-3 py-2 text-[11px] text-amber-300"
                        style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.12)' }}
                      >
                        Generación reforzada: se aplicaron validaciones y reintentos extra para estabilizar esta semana.
                      </div>
                    )}
                    <div className="space-y-2">
                      {selectedWeek.sessions
                        .slice()
                        .sort((a, b) => (a.date === b.date ? (a.timeBlock > b.timeBlock ? 1 : -1) : a.date.localeCompare(b.date)))
                        .map((s, i) => (
                          <div
                            key={i}
                            className="relative overflow-hidden rounded-xl px-3.5 py-2.5"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                          >
                            {/* Sport color indicator */}
                            <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-xl bg-brand opacity-60" />
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-[10px] text-ink-faint">{s.date}</span>
                              <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">{s.timeBlock}</span>
                              <span className="rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-brand-light"
                                style={{ background: 'rgba(255,77,0,0.12)' }}>
                                {s.sessionType}
                              </span>
                              <span className="font-mono text-[10px] text-ink-faint">{s.durationMin}min</span>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-ink">{s.title}</p>
                            {s.objective && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{s.objective}</p>}
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-ink-faint">Selecciona una semana</p>
              </div>
            )}
          </div>

          {/* Validation panel */}
          <div
            className="rounded-2xl p-3.5 space-y-2 md:max-h-[72vh] md:overflow-y-auto"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-ink-faint px-1">
              Validación
            </p>
            {errors.length === 0 && warnings.length === 0 && (
              <div className="rounded-xl px-3 py-2.5 text-xs text-emerald-400 flex items-center gap-1.5"
                style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <CheckCircle2 size={12} /> Sin alertas
              </div>
            )}
            {errors.map((issue, i) => (
              <div key={`e${i}`} className="rounded-xl px-3 py-2.5 text-xs text-red-400 flex items-start gap-2"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)' }}>
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{issue.message}</span>
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={`w${i}`} className="rounded-xl px-3 py-2.5 text-xs text-amber-400 flex items-start gap-2"
                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.18)' }}>
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{issue.message}</span>
              </div>
            ))}

            {plan?.generationSummary && (
              <div className="mt-3 pt-3 text-xs text-ink-faint space-y-1"
                style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <p>Estrategia: <span className="text-ink-muted">{plan.generationSummary.strategy}</span></p>
                <p>{completedWeeks}/{weeks.length} semanas listas</p>
                {failedWeekIndexes.length > 0 && (
                  <p className="text-amber-400">{failedWeekIndexes.length} semana(s) fallida(s)</p>
                )}
              </div>
            )}
          </div>
        </div>
        </>
        )}

        {/* Action bar */}
        {status !== 'done' && !shouldShowLaunchDeck && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {plan?.generationState === 'complete' && (
              <button
                type="button"
                disabled={isGenerating || status === 'committing' || !canAcceptPlan}
                onClick={async () => {
                  const result = await acceptPlan()
                  if (result.errors.length === 0) navigate(ROUTES.WEEK)
                }}
                className="rounded-xl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.15em] text-white transition-all active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg, #ff5500, #ff4d00)',
                  boxShadow: (!isGenerating && canAcceptPlan)
                    ? '0 8px 28px -8px rgba(255,77,0,0.55)' : 'none',
                }}
              >
                {status === 'committing' ? 'Guardando…' : 'Aceptar plan'}
              </button>
            )}
            <button
              type="button"
              disabled={isGenerating || status === 'committing'}
              onClick={async () => { await discard(); navigate(-1) }}
              className="rounded-xl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.15em] text-ink-muted transition-all hover:text-ink disabled:opacity-40"
              style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
            >
              Descartar
            </button>
            {(status === 'failed' || plan?.generationState === 'failed') && (
              <button
                type="button"
                disabled={isGenerating || status === 'committing'}
                onClick={() => { void handleRetryFullGeneration() }}
                className="rounded-xl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.15em] text-white transition-all active:scale-[0.98] disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #ff5500, #ff4d00)' }}
              >
                Reintentar
              </button>
            )}
            {plan?.generationState === 'partial' && hasFailedWeeks && (
              <button
                type="button"
                disabled={isGenerating || status === 'committing'}
                onClick={() => { void handleRetryFailedWeeks() }}
                className="rounded-xl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.15em] text-ink-muted transition-all hover:text-ink disabled:opacity-40"
                style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
              >
                Regenerar fallidas
              </button>
            )}
            {plan?.generationState === 'partial' && (
              <button
                type="button"
                disabled={isGenerating || status === 'committing'}
                onClick={() => { void handleRetryFullGeneration() }}
                className="rounded-xl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.15em] text-ink-muted transition-all hover:text-ink disabled:opacity-40"
                style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
              >
                Reintentar completo
              </button>
            )}
            {acceptBlockers.length > 0 && !isGenerating && status !== 'committing' && (
              <p className="text-xs text-ink-faint">{acceptBlockers[0]}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
