import { schedule, type Handler } from '@netlify/functions'
import { runWhoopCron } from './_shared/whoopCron'

const cronHandler: Handler = async () => runWhoopCron()

export const handler = schedule('0 9 * * *', cronHandler)
