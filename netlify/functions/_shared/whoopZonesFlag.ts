/**
 * Flag de INGESTIÓN, no de visibilidad. El contrato es «no incorporar zonas
 * nuevas desde Whoop», y nada más: apagado no oculta zonas ya persistidas, no
 * impide que un backup importado las traiga y no apaga las superficies.
 *
 * Netlify captura las variables de entorno de Functions POR DEPLOY: cambiar el
 * valor no basta, hay que crear un deploy nuevo.
 */
export function areWhoopZonesEnabled(): boolean {
  return process.env['WHOOP_ZONES_ENABLED'] === 'true'
}
