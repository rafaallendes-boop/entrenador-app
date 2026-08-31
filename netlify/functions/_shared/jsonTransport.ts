/**
 * Serializa JSON usando únicamente bytes ASCII.
 *
 * Las respuestas de la Function atraviesan adaptadores/proxies que pueden
 * trocear el body. Escapar cada code unit no ASCII evita que una secuencia
 * UTF-8 multibyte quede partida y sea decodificada de forma independiente por
 * una capa intermedia. JSON.parse reconstruye exactamente el string original,
 * incluidos pares sustitutos (emoji).
 */
export function stringifyJsonForTransport(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ))
}

