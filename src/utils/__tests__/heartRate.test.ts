import { describe, expect, it } from 'vitest'

import { formatHeartRateTarget, getHeartRateTargetDisplay } from '../heartRate'

describe('heart rate target formatting', () => {
  it('labels low heart-rate ranges as percent of max heart rate', () => {
    expect(getHeartRateTargetDisplay(62, 72)).toEqual({ value: '62–72%', unit: 'FCmax' })
    expect(formatHeartRateTarget(62, 72)).toBe('62–72% FCmax')
  })

  it('labels physiological absolute ranges as bpm', () => {
    expect(getHeartRateTargetDisplay(130, 150)).toEqual({ value: '130–150', unit: 'bpm' })
    expect(formatHeartRateTarget(130, 150)).toBe('130–150 bpm')
  })
})
