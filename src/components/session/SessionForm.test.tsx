// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionForm from './SessionForm'
import {
  draftToNewSessionFields,
  sessionToDraft,
  type CoachSessionDraft,
} from '../../services/athlete/coachSessionSerializer'
import { SQUASH_DRILL_LIBRARY } from '../../services/training/drillLibrary'
import type { Session } from '../../types'

afterEach(cleanup)

const initial: CoachSessionDraft = {
  date: '2026-07-14', timeBlock: 'PM', type: 'running', title: 'Tempo',
  durationMin: 50, objective: 'Umbral', location: 'Parque', rpe: 7, notes: 'Control',
  runningTargets: { runningType: 'tempo', targetPaceMin: '4:50', targetHrMax: 170 },
}

const matchInitial: CoachSessionDraft = {
  date: '2026-07-19', timeBlock: 'AM', type: 'squash', title: 'Partido', durationMin: 60,
  subtype: 'match', opponent: 'Juan', matchResult: 'win', gamesWon: 3, gamesLost: 1,
}

describe('SessionForm', () => {
  it('usa defaultDate en create y entrega solo un CoachSessionDraft', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="squash" defaultDate="2026-07-18" heading="Nueva sesion" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    expect((screen.getByLabelText('Fecha') as HTMLInputElement).value).toBe('2026-07-18')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    const value = onSubmit.mock.calls[0][0]
    expect(value).toMatchObject({
      type: 'squash', squashKind: 'technical', subtype: 'training',
    })
    expect(value).not.toHaveProperty('status')
    expect(value).not.toHaveProperty('warmup')
    expect(value).not.toHaveProperty('squashDetails')
  })

  it('precarga modo edición y conserva limpiezas como undefined', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm initialValues={initial} defaultSport="squash" heading="Editar sesion" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Tempo')
    expect((screen.getByLabelText('Ritmo min (min/km)') as HTMLInputElement).value).toBe('4:50')
    fireEvent.change(screen.getByLabelText('Objetivo'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('RPE planificado'), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ objective: undefined, rpe: undefined })
  })

  it('cambiar el tipo preserva un título personalizado', async () => {
    render(<SessionForm initialValues={initial} defaultSport="squash" heading="Editar sesion" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fuerza' }))
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Tempo')
  })

  it('cambiar el tipo actualiza el título mientras siga siendo el default automático', async () => {
    render(<SessionForm defaultSport="squash" heading="Nueva sesion" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Running' }))
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Salida de running')
  })

  it('muestra errores, no cancela y rehabilita los controles', async () => {
    const onCancel = vi.fn()
    render(<SessionForm defaultSport="squash" heading="Nueva sesion" submitLabel="Guardar" onSubmit={async () => { throw new Error('Sin conexión') }} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Sin conexión')
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('modo plantilla oculta fecha y datos de partido', () => {
    render(
      <SessionForm
        mode="template"
        initialValues={{
          date: '2026-07-14', timeBlock: 'AM', type: 'squash', title: 'Match',
          durationMin: 60, subtype: 'match', opponent: 'Rival',
        }}
        defaultSport="squash"
        heading="Plantilla"
        submitLabel="Guardar"
        onSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Fecha')).toBeNull()
    expect(screen.queryByLabelText('Rival')).toBeNull()
    expect(screen.getByLabelText('Nombre de plantilla')).toBeTruthy()
  })

  it('modo sesión conserva fecha y datos de partido', () => {
    render(
      <SessionForm
        initialValues={{
          date: '2026-07-14', timeBlock: 'AM', type: 'squash', title: 'Match',
          durationMin: 60, subtype: 'match', opponent: 'Rival',
        }}
        defaultSport="squash"
        heading="Sesión"
        submitLabel="Guardar"
        onSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Fecha')).toBeTruthy()
    expect((screen.getByLabelText('Rival') as HTMLInputElement).value).toBe('Rival')
    expect(screen.queryByLabelText('Nombre de plantilla')).toBeNull()
  })

  it('con allowMatchResult=false oculta resultado y games pero mantiene Rival', () => {
    render(
      <SessionForm
        defaultSport="squash"
        allowMatchResult={false}
        initialValues={matchInitial}
        heading="Editar"
        submitLabel="Guardar"
        onSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Rival')).not.toBeNull()
    expect(screen.queryByLabelText('Games ganados')).toBeNull()
    expect(screen.queryByLabelText('Games perdidos')).toBeNull()
    expect(screen.queryByText('Gane')).toBeNull()
  })

  it('con allowMatchResult=false preserva el resultado existente al guardar', async () => {
    const onSubmit = vi.fn(async () => {})
    render(
      <SessionForm
        defaultSport="squash"
        allowMatchResult={false}
        initialValues={matchInitial}
        heading="Editar"
        submitLabel="Guardar"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      matchResult: 'win', gamesWon: 3, gamesLost: 1, opponent: 'Juan',
    })
  })

  it('match → training → match no resucita el resultado anterior', async () => {
    const onSubmit = vi.fn(async () => {})
    render(
      <SessionForm
        defaultSport="squash"
        allowMatchResult={false}
        initialValues={matchInitial}
        heading="Editar"
        submitLabel="Guardar"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Técnico (con partner)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Partido' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      matchResult: undefined, gamesWon: undefined, gamesLost: undefined,
    })
  })

  it('por defecto el atleta sigue viendo el bloque completo de partido', () => {
    render(
      <SessionForm
        defaultSport="squash"
        initialValues={matchInitial}
        heading="Nueva"
        submitLabel="Guardar"
        onSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Games ganados')).not.toBeNull()
  })

  it('declara modalidad y proyecta un subtype compatible', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)

    expect(screen.getByText('Modalidad')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Control (solo)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      squashKind: 'control', subtype: 'control',
    })
  })

  it('separa práctica de competencia cuando la modalidad es partido', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Partido' }))
    expect(screen.getByText('Contexto del partido')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Competencia' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      squashKind: 'match', subtype: 'competitive',
    })
  })

  it('distingue visualmente el contexto de partido seleccionado', async () => {
    render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Partido' }))
    const practice = screen.getByRole('button', { name: 'Práctica' })
    const competition = screen.getByRole('button', { name: 'Competencia' })

    // aria-pressed ya distinguía para lectores de pantalla; para quien ve la
    // pantalla las dos píldoras eran idénticas.
    expect(practice.className).not.toBe(competition.className)

    await userEvent.click(competition)
    expect(screen.getByRole('button', { name: 'Competencia' }).className)
      .not.toBe(screen.getByRole('button', { name: 'Práctica' }).className)
  })

  it('advierte un drill conocido incompatible pero permite guardarlo intacto', async () => {
    const technical = SQUASH_DRILL_LIBRARY.find((drill) => drill.sessionKind === 'technical')!
    const onSubmit = vi.fn(async () => {})
    render(
      <SessionForm
        initialValues={{
          date: '2026-07-19', timeBlock: 'AM', type: 'squash', title: 'Control',
          durationMin: 45, subtype: 'control', squashKind: 'control',
          exercises: [{
            id: 'known-1', name: technical.name, sets: 3, reps: '10',
            libraryRef: { source: 'squash_drill', id: technical.id },
          }],
        }}
        defaultSport="squash"
        heading="Editar"
        submitLabel="Guardar"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain(technical.name)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit.mock.calls[0][0].exercises[0]).toMatchObject({
      name: technical.name,
      libraryRef: { source: 'squash_drill', id: technical.id },
    })
  })

  it('acepta ejercicios personalizados sin metadata bajo la modalidad elegida', () => {
    render(
      <SessionForm
        initialValues={{
          date: '2026-07-19', timeBlock: 'AM', type: 'squash', title: 'Control',
          durationMin: 45, subtype: 'control', squashKind: 'control',
          exercises: [{ id: 'custom-1', name: 'Mi patrón propio', sets: 3, reps: '10' }],
        }}
        defaultSport="squash"
        heading="Editar"
        submitLabel="Guardar"
        onSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('muestra ejercicios en squash y los envía en el draft', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('+ Añadir ejercicio'))
    fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'Boast + drive' } })
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(onSubmit.mock.calls[0][0].exercises).toEqual([
      expect.objectContaining({ name: 'Boast + drive' }),
    ])
  })

  it('conserva filas squash→fuerza y las descarta al pasar por running', async () => {
    render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Agregar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('+ Añadir ejercicio'))
    fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'Boast + drive' } })
    await userEvent.click(screen.getByRole('button', { name: 'Fuerza' }))
    expect((screen.getByLabelText('Ejercicio 1') as HTMLInputElement).value).toBe('Boast + drive')
    await userEvent.click(screen.getByRole('button', { name: 'Running' }))
    await userEvent.click(screen.getByRole('button', { name: 'Squash' }))
    expect(screen.queryByLabelText('Ejercicio 1')).toBeNull()
  })

  it('guardar → sessionToDraft → reabrir muestra el ejercicio en squash', () => {
    const fields = draftToNewSessionFields({
      date: '2026-07-19', timeBlock: 'AM', type: 'squash', title: 'Squash', durationMin: 60,
      subtype: 'training',
      exercises: [{ id: 'e1', name: 'Boast + drive', sets: 3, reps: '10' }],
    })
    const session = { ...fields, id: 's1', createdAt: 1, updatedAt: 1 } as Session
    render(<SessionForm initialValues={sessionToDraft(session)} defaultSport="squash" heading="Editar" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    expect((screen.getByLabelText('Ejercicio 1') as HTMLInputElement).value).toBe('Boast + drive')
  })

  it('mobility mantiene input de texto libre sin combobox', () => {
    render(<SessionForm defaultSport="mobility" heading="Nueva" submitLabel="Agregar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('+ Añadir ejercicio'))
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByLabelText('Ejercicio 1')).not.toBeNull()
  })

  it('elegir una sugerencia prellena defaults, estampa libraryRef y no pisa campos tocados', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="strength" heading="Nueva" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('+ Añadir ejercicio'))
    fireEvent.change(screen.getByLabelText('Reps 1'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'sentadilla trasera' } })
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    const exercise = onSubmit.mock.calls[0][0].exercises[0]
    expect(exercise.libraryRef).toMatchObject({ source: 'strength_exercise' })
    expect(exercise.reps).toBe('12')
    expect(exercise.sets).toBe(4)
  })

  it('cambiar de entrada A a B actualiza solo campos no tocados', () => {
    render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Agregar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('+ Añadir ejercicio'))
    fireEvent.change(screen.getByLabelText('Reps 1'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: SQUASH_DRILL_LIBRARY[0].name } })
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    expect((screen.getByLabelText('Notas ejercicio 1') as HTMLInputElement).value.length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'sentadilla trasera' } })
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    expect((screen.getByLabelText('Series 1') as HTMLInputElement).value).toBe('4')
    expect((screen.getByLabelText('Reps 1') as HTMLInputElement).value).toBe('12')
    expect((screen.getByLabelText('Notas ejercicio 1') as HTMLInputElement).value).toBe('')
  })

  it('editar el nombre después de elegir borra el libraryRef', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="strength" heading="Nueva" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('+ Añadir ejercicio'))
    fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'sentadilla trasera' } })
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'Mi variante propia' } })
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(onSubmit.mock.calls[0][0].exercises[0].libraryRef).toBeUndefined()
  })

  it('el explorador agrega filas prellenadas con libraryRef sin cerrar el formulario', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="strength" heading="Nueva" submitLabel="Agregar sesión" onSubmit={onSubmit} onCancel={vi.fn()} />)
    const openLibrary = screen.getByRole('button', { name: 'Agregar desde biblioteca' })
    openLibrary.focus()
    fireEvent.click(openLibrary)
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: /^Agregar / })[0])
    fireEvent.click(screen.getByLabelText('Cerrar biblioteca'))
    expect(document.activeElement).toBe(openLibrary)
    await userEvent.click(screen.getByRole('button', { name: 'Agregar sesión' }))
    const exercise = onSubmit.mock.calls[0][0].exercises[0]
    expect(exercise.libraryRef).toBeDefined()
    expect(exercise.name.length).toBeGreaterThan(0)
  })

  it('Enter en la búsqueda del explorador no envía el formulario', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="strength" heading="Nueva" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar desde biblioteca' }))
    await userEvent.type(screen.getByLabelText('Buscar en la biblioteca'), 's{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('el nombre sigue al título hasta que el usuario lo toca y se entrega con trim', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm mode="template" defaultSport="squash" heading="Plantilla" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Titulo'), { target: { value: 'Técnica' } })
    expect((screen.getByLabelText('Nombre de plantilla') as HTMLInputElement).value).toBe('Técnica')
    fireEvent.change(screen.getByLabelText('Nombre de plantilla'), { target: { value: '  Favorita  ' } })
    fireEvent.change(screen.getByLabelText('Titulo'), { target: { value: 'Título final' } })
    expect((screen.getByLabelText('Nombre de plantilla') as HTMLInputElement).value).toBe('  Favorita  ')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit.mock.calls[0][1]).toEqual({ templateName: 'Favorita' })
  })
})
