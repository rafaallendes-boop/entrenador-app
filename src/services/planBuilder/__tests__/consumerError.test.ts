import { describe, expect, it } from 'vitest'
import { getPlanBuilderDailyQuotaNotice } from '../consumerError'
import {
  PLAN_BUILDER_DAILY_QUOTA_MESSAGE_PREFIX,
  PlanBuilderDailyQuotaError,
} from '../dailyQuotaError'

describe('getPlanBuilderDailyQuotaNotice', () => {
  it('turns the known detailed quota error into specific consumer-safe copy', () => {
    const notice = getPlanBuilderDailyQuotaNotice(
      new PlanBuilderDailyQuotaError({ requested: 9, remaining: 7, limit: 12 }),
    )

    expect(notice).toBe(
      'No tienes cuota diaria suficiente para crear este plan: necesita 9 semanas y hoy te quedan 7 de 12. Vuelve mañana o reduce la cantidad de semanas.',
    )
  })

  it('uses singular copy for a one-week request', () => {
    expect(getPlanBuilderDailyQuotaNotice(
      new PlanBuilderDailyQuotaError({ requested: 1, remaining: 0, limit: 12 }),
    )).toContain('necesita 1 semana y hoy te quedan 0 de 12')
  })

  it('falls back to safe quota copy when a recognized prefix has unexpected details', () => {
    const notice = getPlanBuilderDailyQuotaNotice(
      `${PLAN_BUILDER_DAILY_QUOTA_MESSAGE_PREFIX}: database failed at private_table token=secret`,
    )

    expect(notice).toBe(
      'No tienes cuota diaria suficiente para crear este plan. Vuelve mañana o reduce la cantidad de semanas.',
    )
    expect(notice).not.toContain('private_table')
    expect(notice).not.toContain('secret')
  })

  it('does not expose arbitrary technical or provider rate-limit errors', () => {
    expect(getPlanBuilderDailyQuotaNotice('Payload inválido: relation training_plans denied')).toBeNull()
    expect(getPlanBuilderDailyQuotaNotice('Rate limit alcanzado. provider request id req_secret')).toBeNull()
    expect(getPlanBuilderDailyQuotaNotice(null)).toBeNull()
  })
})
