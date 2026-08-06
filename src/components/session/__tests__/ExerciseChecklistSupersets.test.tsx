// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import ExerciseChecklist from '../ExerciseChecklist'
import type { Exercise } from '../../../types'

afterEach(cleanup)

vi.mock('../../../store/useTrainingStore', () => ({
  useTrainingStore: (selector: (state: { toggleExercise: () => void }) => unknown) =>
    selector({ toggleExercise: () => undefined }),
}))

const ex = (id: string, name: string, supersetGroup?: string): Exercise => ({
  id,
  name,
  sets: 4,
  reps: 8,
  completed: false,
  ...(supersetGroup ? { supersetGroup } : {}),
})

describe('ExerciseChecklist con superseries', () => {
  it('tolera una lista vacia fuera de fuerza', () => {
    const { container } = render(
      <ExerciseChecklist sessionId="s1" sessionType="mobility" exercises={[]} />,
    )

    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('muestra el encabezado del grupo con letra, tipo y rondas', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[ex('1', 'Clean', 'g1'), ex('2', 'Dominadas', 'g1')]}
      />,
    )

    expect(screen.getByText(/A · Superserie · 4 rondas/)).not.toBeNull()
  })

  it('deriva Triserie para tres miembros', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[ex('1', 'Clean', 'g1'), ex('2', 'Dominadas', 'g1'), ex('3', 'Salto al cajon', 'g1')]}
      />,
    )

    expect(screen.getByText(/A · Triserie · 4 rondas/)).not.toBeNull()
  })

  it('no muestra encabezado para ejercicios sueltos', () => {
    render(
      <ExerciseChecklist sessionId="s1" sessionType="strength" exercises={[ex('1', 'Clean')]} />,
    )

    expect(screen.queryByText(/Superserie/)).toBeNull()
  })

  it('no parte un grupo que cruza bloques visuales', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[
          ex('1', 'Plancha frontal', 'g1'),          // bloque visual: core
          ex('2', 'Peso muerto con trap bar', 'g1'), // bloque visual: strength
        ]}
      />,
    )

    // Un solo encabezado de grupo: el segmento entero vive en el bloque de su
    // lider (core), no se reparte en dos secciones.
    expect(screen.getAllByText(/· Superserie ·/)).toHaveLength(1)
    expect(screen.getByText('Peso muerto con trap bar')).not.toBeNull()
  })

  it('no repite la palabra reps en un target de tiempo', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[
          { id: '1', name: 'Plancha frontal', sets: 4, reps: '30s', completed: false, supersetGroup: 'g1' },
          ex('2', 'Pallof press', 'g1'),
        ]}
      />,
    )

    expect(screen.getByText('30s')).not.toBeNull()
    expect(screen.queryByText('30s reps')).toBeNull()
  })

  it('muestra reps cuando el editor guardo un target numerico como string', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[
          { id: '1', name: 'Clean', sets: 4, reps: '3', completed: false, supersetGroup: 'g1' },
          { id: '2', name: 'Dominadas', sets: 4, reps: '8-10', completed: false, supersetGroup: 'g1' },
        ]}
      />,
    )

    expect(screen.getByText('3 reps')).not.toBeNull()
    expect(screen.getByText('8-10 reps')).not.toBeNull()
  })

  it('mantiene un check por ejercicio dentro del grupo', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[ex('1', 'Clean', 'g1'), ex('2', 'Dominadas', 'g1')]}
      />,
    )

    expect(screen.getByText('Clean')).not.toBeNull()
    expect(screen.getByText('Dominadas')).not.toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('numera los grupos de forma global entre bloques visuales distintos, sin reiniciar por bloque', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[
          ex('1', 'Plancha frontal', 'g1'), // bloque visual: core (se renderiza primero)
          ex('2', 'Pallof press', 'g1'),
          ex('3', 'Peso muerto con trap bar', 'g2'), // bloque visual: strength
          ex('4', 'Press vertical', 'g2'),
        ]}
      />,
    )

    const headers = screen.getAllByText(/· Superserie · 4 rondas/)
    expect(headers).toHaveLength(2)
    // El contador de letras es global al orden final de render (cruza
    // bloques), no se reinicia por bloque visual: core sale A, strength sale B.
    expect(headers[0]!.textContent).toMatch(/^A ·/)
    expect(headers[1]!.textContent).toMatch(/^B ·/)
  })
})
