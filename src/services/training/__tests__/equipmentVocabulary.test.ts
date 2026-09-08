import { describe, expect, it } from 'vitest'

import { detectEquipmentMentionsInName, resolveDeclaredEquipment } from '../equipmentVocabulary'

describe('inventario de equipamiento declarado por el atleta', () => {
  it('distingue ausencia de selección vacía', () => {
    // Ausente = perfil viejo o sin declarar: se conserva la compatibilidad.
    const undeclared = resolveDeclaredEquipment(undefined)
    expect(undeclared.declared).toBe(false)
    expect(undeclared.equipment).toContain('barbell')
    expect(undeclared.equipment).toContain('machine')

    // Vacío = el atleta abrió el selector y no eligió nada. No es un gimnasio
    // completo: es una selección que la UI debe resolver.
    const empty = resolveDeclaredEquipment([])
    expect(empty.declared).toBe(true)
    expect(empty.equipment).toEqual([])
  })

  it('reconoce tildes y equipo específico que hoy caen al fallback', () => {
    expect(resolveDeclaredEquipment(['máquinas']).equipment).toEqual(['machine'])
    expect(resolveDeclaredEquipment(['Smith']).equipment).toEqual(['smith'])
    expect(resolveDeclaredEquipment(['poleas']).equipment).toEqual(['cable'])
  })

  it('no asciende una máquina puntual a "tiene todas las máquinas"', () => {
    // Declarar una prensa no acredita peck deck ni hack squat. Se registra como
    // no reconocido en vez de ampliar el inventario por cuenta propia.
    const resolved = resolveDeclaredEquipment(['barra', 'prensa'])
    expect(resolved.equipment).toEqual(['barbell'])
    expect(resolved.unrecognized).toEqual(['prensa'])
  })

  it('no habilita un gimnasio completo cuando no entiende lo declarado', () => {
    // Una declaración desconocida necesita corrección, no equipo supuesto.
    const resolved = resolveDeclaredEquipment(['elíptica'])
    expect(resolved.declared).toBe(true)
    expect(resolved.unrecognized).toEqual(['elíptica'])
    expect(resolved.equipment).toEqual([])
  })
})

describe('menciones de equipamiento en el nombre de un ejercicio', () => {
  it('no confunde "peso muerto" con peso corporal', () => {
    expect(detectEquipmentMentionsInName('Peso muerto').requested).toEqual([])
    expect(detectEquipmentMentionsInName('Sentadilla con peso corporal').requested).toEqual(['bodyweight'])
  })

  it('separa lo pedido de lo negado', () => {
    const mentions = detectEquipmentMentionsInName('Press banca sin máquina')
    expect(mentions.requested).toEqual([])
    expect(mentions.negated).toEqual(['machine'])
  })
})
