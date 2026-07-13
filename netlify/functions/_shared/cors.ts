import type { HandlerResponse } from '@netlify/functions'

/** Capacitor sends Origin: capacitor://localhost for calls to the HTTPS backend. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function corsPreflight(): HandlerResponse {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' }
}
