/**
 * Columnas que cliente y servidor piden a PostgREST. Nunca `select=*`: `note`
 * está fuera del grant de 020 y pedirla hace fallar la consulta entera.
 * El guard en __tests__/entitlementColumns.test.ts cruza esta lista contra el
 * .sql, así que ampliar la migración sin tocar el código rompe en CI en vez de
 * dar 400 en producción.
 */
export const USER_ENTITLEMENT_SELECT_COLUMNS = [
  'tier',
  'expires_at',
] as const

export const USER_ENTITLEMENT_SELECT = USER_ENTITLEMENT_SELECT_COLUMNS.join(',')
