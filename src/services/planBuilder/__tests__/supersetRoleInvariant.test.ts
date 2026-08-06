import { describe, expect, it } from 'vitest'

import { collectCountableKeys, resolveSessionStrengthRoles } from '../strengthRoleContract'

const ex = (name: string, supersetGroup?: string) => ({ name, ...(supersetGroup ? { supersetGroup } : {}) })

describe('resolveSessionStrengthRoles con grupos', () => {
  it('un seguidor nunca es main_lift', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Clean', 'g1'),
      ex('Dominadas', 'g1'),
      ex('Peso muerto con trap bar'),
    ])

    expect(roles[1]).toBe('accessory')
    expect(roles[2]).toBe('main_lift')
  })

  it('un core dentro de un grupo sigue siendo trunk', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Sentadilla trasera con barra'),
      ex('Plancha frontal', 'g1'),
      ex('Pallof press', 'g1'),
    ])

    expect(roles[1]).toBe('trunk')
    expect(roles[2]).toBe('trunk')
  })

  it('un power dentro de un grupo sigue siendo power', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Peso muerto con trap bar'),
      ex('Remo en maquina', 'g1'),
      ex('Salto al cajon', 'g1'),
    ])

    expect(roles[2]).toBe('power')
  })

  it('sin grupos el comportamiento es identico al anterior', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Plancha frontal'),
      ex('Clean'),
      ex('Peso muerto con trap bar'),
      ex('Remo con pecho apoyado'),
    ])

    expect(roles).toEqual(['trunk', 'power', 'main_lift', 'accessory'])
  })
})

describe('elegibilidad de lider', () => {
  it('solo el primer miembro de un segmento es elegible para main_lift', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Clean', 'g1'),
      ex('Dominadas', 'g1'),
      ex('Peso muerto con trap bar'),
      ex('Remo con pecho apoyado'),
    ])

    expect(roles).toEqual(['power', 'accessory', 'main_lift', 'accessory'])
  })
})

// La invariante COMPLETA -- main_lift(entrada) === main_lift(salida de la
// politica, ya con reflow) -- se prueba en supersetPolicy.test.ts (Task 10),
// que es donde la politica existe. Acá solo se fija la regla de elegibilidad
// sobre la que esa invariante se apoya.

describe('no regresion de calidad', () => {
  it('agrupar el candidato a main_lift como lider preserva el conjunto contable', () => {
    // El lider de 'g1' es 'Peso muerto con trap bar', que ya era el
    // candidato a main_lift sin agrupar (unico ejercicio no-core/power,
    // primero en orden). Agruparlo como lider no le cambia el rol: sigue
    // exento, y su seguidor ('Remo con pecho apoyado') ya era 'accessory'
    // de todos modos. Este es el caso que la politica determinista siempre
    // produce (nunca agrupa el main_lift como seguidor de otra cosa).
    const ungrouped = {
      sessionType: 'strength',
      exercises: [
        { name: 'Peso muerto con trap bar' },
        { name: 'Remo con pecho apoyado' },
      ],
    }
    const grouped = {
      sessionType: 'strength',
      exercises: [
        { name: 'Peso muerto con trap bar', supersetGroup: 'g1' },
        { name: 'Remo con pecho apoyado', supersetGroup: 'g1' },
      ],
    }

    const before = collectCountableKeys([ungrouped])
    const after = collectCountableKeys([grouped])

    expect([...before].sort()).toEqual(['chest_supported_row'])
    expect([...after].sort()).toEqual([...before].sort())
  })

  it('forzar al candidato a main_lift como seguidor SI cambia el conjunto contable', () => {
    // Caracterizacion, no invariante: demuestra que la regla de seguidor
    // puede mover el conjunto contable, para que el test de arriba (donde
    // no lo mueve) no sea tautologico.
    //
    // Sin agrupar, 'Press vertical' es el primer no-core/power y se lleva
    // el main_lift (exento); 'Peso muerto con trap bar' queda accessory.
    // Agrupado como seguidor de 'Plancha frontal' (core, siempre lider),
    // 'Press vertical' pierde elegibilidad y pasa a accessory; el main_lift
    // se corre al siguiente lider disponible, 'Peso muerto con trap bar'.
    //
    // Esta construccion -- un main_lift candidato agrupado como seguidor --
    // es exactamente la que la politica determinista tiene prohibido
    // generar (nunca usa el main_lift como seguidor). Por eso la invariante
    // de preservacion real se prueba sobre la politica, en su propia suite
    // (supersetPolicy.test.ts), no aca: aca solo se caracteriza que la regla
    // de elegibilidad de seguidor es capaz de mover el conjunto contable.
    const ungrouped = {
      sessionType: 'strength',
      exercises: [
        { name: 'Plancha frontal' },
        { name: 'Press vertical' },
        { name: 'Peso muerto con trap bar' },
      ],
    }
    const grouped = {
      sessionType: 'strength',
      exercises: [
        { name: 'Plancha frontal', supersetGroup: 'g1' },
        { name: 'Press vertical', supersetGroup: 'g1' },
        { name: 'Peso muerto con trap bar' },
      ],
    }

    const before = collectCountableKeys([ungrouped])
    const after = collectCountableKeys([grouped])

    expect([...before].sort()).toEqual(['plank', 'trap_bar_deadlift'])
    expect([...after].sort()).toEqual(['overhead_press', 'plank'])
    expect([...after].sort()).not.toEqual([...before].sort())
  })
})
