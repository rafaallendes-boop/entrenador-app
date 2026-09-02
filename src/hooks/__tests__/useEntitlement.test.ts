// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENTITLEMENT_SOURCE } from '../../types/entitlement'
import { useEntitlement } from '../useEntitlement'
import { useEntitlementStore } from '../../store/useEntitlementStore'

describe('useEntitlement', () => {
  beforeEach(() => {
    useEntitlementStore.setState({
      tier: 'free',
      loading: false,
      source: ENTITLEMENT_SOURCE.REMOTE,
      hydrated: true,
      userId: 'athlete-1',
    })
  })

  afterEach(() => {
    cleanup()
    useEntitlementStore.getState().reset()
  })

  it('expone la decisión consultiva para un atleta Free y conserva canUse', () => {
    const { result } = renderHook(() => useEntitlement())

    expect(result.current.decide('week_creator')).toMatchObject({
      allowed: false,
      tier: 'free',
      requiredTier: 'weekly',
    })
    expect(result.current.canUse).toBeTypeOf('function')
    expect(result.current.canUse('week_creator')).toBe(false)
  })

  it('reconoce las capacidades Weekly sin conceder Advanced', () => {
    useEntitlementStore.setState({ tier: 'weekly' })
    const { result } = renderHook(() => useEntitlement())

    expect(result.current.decide('week_creator')).toMatchObject({
      allowed: true,
      tier: 'weekly',
      requiredTier: 'weekly',
    })
    expect(result.current.decide('plan_builder_week')).toMatchObject({
      allowed: false,
      tier: 'weekly',
      requiredTier: 'advanced',
    })
  })
})
