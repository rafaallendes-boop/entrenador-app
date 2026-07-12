import { schedule, type Handler } from '@netlify/functions'
import { runPlanGenerationTelemetryRetention } from './_shared/planGenerationTelemetryRetention'

const cronHandler: Handler = async () => runPlanGenerationTelemetryRetention()

export const handler = schedule('0 4 * * *', cronHandler)
