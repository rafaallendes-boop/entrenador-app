import { describe, expect, it } from 'vitest'

import {
  buildWeeklyActionComposerDraft,
  buildWeeklyActionLaunchUrl,
  parseWeeklyActionLaunchIntent,
} from '../weeklyLaunchIntent'

describe('weeklyLaunchIntent', () => {
  it('serializes and parses launch intents through query params', () => {
    const url = buildWeeklyActionLaunchUrl({
      intent: 'open_auto_adjustment',
      date: '2026-04-08',
      alertId: 'macro-week-coherence-warning',
      source: 'activation-auto-adjustment',
      weeklyRule: 'reduce accessory load',
    })

    expect(url).toBe(
      '/week?weeklyIntent=open_auto_adjustment&weeklyDate=2026-04-08&weeklyAlertId=macro-week-coherence-warning&weeklySource=activation-auto-adjustment&weeklyRule=reduce+accessory+load',
    )

    expect(parseWeeklyActionLaunchIntent(url.split('?')[1] ?? '')).toEqual({
      intent: 'open_auto_adjustment',
      date: '2026-04-08',
      alertId: 'macro-week-coherence-warning',
      source: 'activation-auto-adjustment',
      weeklyRule: 'reduce accessory load',
    })
  })

  it('builds a chat adjustment draft from the weekly rule', () => {
    expect(buildWeeklyActionComposerDraft({
      intent: 'chat_adjust_week',
      weeklyRule: 'squash principal, soporte minimo',
    })).toContain('squash principal')
  })
})
