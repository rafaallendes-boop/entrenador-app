import { describe, expect, it } from 'vitest'

import { hasUnrecognizedRestrictionText } from '../../training/strengthSafetyConstraints'

describe('texto de restricción no reconocido', () => {
  // El contrato esqueleto deja que los selectores locales compongan la sesión.
  // El comentario de WeekCreatorEngine dice que un texto médico libre debe usar
  // el contrato detallado; mirar sólo las restricciones YA PARSEADAS invierte
  // eso: lo que el parser no entiende es justo lo que no se puede delegar.
  it('reconoce texto que el parser no resolvió ni descartó como ausencia', () => {
    expect(hasUnrecognizedRestrictionText({ restrictions: 'evitar cargas altas' })).toBe(true)
    expect(hasUnrecognizedRestrictionText({ currentInjuries: 'me siento raro al entrenar' })).toBe(true)
    expect(hasUnrecognizedRestrictionText({ injuryNotes: 'seguir indicaciones del kine' })).toBe(true)
  })

  it('no marca una declaración de ausencia', () => {
    for (const text of ['Ninguna', 'Ninguna.', 'ninguna lesión', 'todo bien', 'sin lesiones', '']) {
      expect(hasUnrecognizedRestrictionText({ currentInjuries: text }), text).toBe(false)
    }
  })

  it('no marca texto que SÍ resolvió en una restricción concreta', () => {
    expect(hasUnrecognizedRestrictionText({ currentInjuries: 'dolor lumbar' })).toBe(false)
    expect(hasUnrecognizedRestrictionText({ restrictions: 'evitar impacto' })).toBe(false)
  })

  it('no marca fatiga, que es señal de carga y no médica', () => {
    expect(hasUnrecognizedRestrictionText({ restrictions: 'mucho cansancio' })).toBe(false)
  })
})
