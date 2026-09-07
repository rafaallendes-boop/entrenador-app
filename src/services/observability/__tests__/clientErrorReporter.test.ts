import { describe, expect, it, vi } from 'vitest'
import {
  MAX_REPORTS_PER_TAB,
  TRANSPORT_PAUSE_MS,
  createClientErrorReporter,
  type CapturedClientError,
} from '../clientErrorReporter'

function evento(overrides: Partial<CapturedClientError> = {}): CapturedClientError {
  return {
    source: 'react_boundary',
    diagnosticCode: 'render_failure',
    scopeKind: 'self',
    errorName: 'TypeError',
    component: 'PlanBuilderV2',
    route: '/plans/builder',
    stackFrames: null,
    requestClass: null,
    ...overrides,
  }
}

function reporter(overrides: Record<string, unknown> = {}) {
  const clock = { valor: 0 }
  const transport = vi.fn(async () => 204)
  const instancia = createClientErrorReporter({
    transport,
    now: () => clock.valor,
    enabled: true,
    currentAccountId: () => 'cuenta-a',
    release: 'r1',
    platform: 'web',
    ...overrides,
  })
  return { instancia, transport, clock }
}

describe('createClientErrorReporter — condiciones de envío', () => {
  it('envía un evento válido una vez', async () => {
    const { instancia, transport } = reporter()
    await instancia.report(evento())
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('incluye release y plataforma en el cuerpo', async () => {
    const { instancia, transport } = reporter()
    await instancia.report(evento())

    const body = JSON.parse(transport.mock.calls[0]![0] as unknown as string) as Record<string, unknown>
    expect(body['release']).toBe('r1')
    expect(body['platform']).toBe('web')
    expect(body['route']).toBe('/plans/builder')
  })

  it('no envía nada con la flag apagada', async () => {
    const { instancia, transport } = reporter({ enabled: false })
    await instancia.report(evento())
    expect(transport).not.toHaveBeenCalled()
  })

  // Sin sesión no hay a quién atribuir el evento, y v1 no acepta anónimos.
  // Se descarta en el acto: ni cola, ni almacenamiento local, ni reenvío al
  // iniciar sesión después.
  it('descarta sin sesión y no encola', async () => {
    const { instancia, transport } = reporter({ currentAccountId: () => null })
    await instancia.report(evento())
    expect(transport).not.toHaveBeenCalled()

    const conSesion = reporter()
    await conSesion.instancia.report(evento())
    expect(conSesion.transport).toHaveBeenCalledTimes(1)
  })

  it('nunca lanza al consumidor aunque el transporte lance', async () => {
    const transport = vi.fn(async () => {
      throw new Error('red caída')
    })
    const { instancia } = reporter({ transport })
    await expect(instancia.report(evento())).resolves.toBeUndefined()
  })
})

describe('createClientErrorReporter — dedupe', () => {
  it('no reenvía un evento idéntico dentro de la sesión', async () => {
    const { instancia, transport } = reporter()
    await instancia.report(evento())
    await instancia.report(evento())
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('sí envía un evento que difiere en algún campo de la firma', async () => {
    const { instancia, transport } = reporter()
    await instancia.report(evento())
    await instancia.report(evento({ route: '/coach' }))
    expect(transport).toHaveBeenCalledTimes(2)
  })

  // La reserva va **antes** del await: si se hiciera después, un componente en
  // loop dispararía N envíos idénticos antes de que el primero resolviera.
  it('reserva la firma antes del await: dos concurrentes envían una sola vez', async () => {
    let resolver: (value: number) => void = () => {}
    const transport = vi.fn(
      () => new Promise<number>((resolve) => {
        resolver = resolve
      }),
    )
    const { instancia } = reporter({ transport })

    const a = instancia.report(evento())
    const b = instancia.report(evento())
    resolver(204)
    await Promise.all([a, b])

    expect(transport).toHaveBeenCalledTimes(1)
  })
})

describe('createClientErrorReporter — cap por pestaña', () => {
  it(`corta después de ${MAX_REPORTS_PER_TAB} intentos`, async () => {
    const { instancia, transport } = reporter()
    for (let i = 0; i < MAX_REPORTS_PER_TAB + 5; i += 1) {
      await instancia.report(evento({ route: i % 2 === 0 ? '/week' : '/coach', errorName: `E${i}` }))
    }
    expect(transport).toHaveBeenCalledTimes(MAX_REPORTS_PER_TAB)
  })

  // El cap cuenta intentos, no éxitos: si contara éxitos, un endpoint caído
  // dejaría reintentar sin techo.
  it('cuenta intentos, no envíos exitosos', async () => {
    const transport = vi.fn(async () => 500)
    const { instancia } = reporter({ transport })
    for (let i = 0; i < MAX_REPORTS_PER_TAB + 3; i += 1) {
      await instancia.report(evento({ errorName: `E${i}` }))
    }
    expect(transport.mock.calls.length).toBeLessThanOrEqual(MAX_REPORTS_PER_TAB)
  })
})

describe('createClientErrorReporter — circuit breaker', () => {
  it('pausa los eventos nuevos tras el primer fallo de transporte', async () => {
    const transport = vi.fn(async () => null)
    const { instancia, clock } = reporter({ transport })

    await instancia.report(evento({ errorName: 'E1' }))
    expect(transport).toHaveBeenCalledTimes(1)

    clock.valor += TRANSPORT_PAUSE_MS - 1
    await instancia.report(evento({ errorName: 'E2' }))
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('reanuda cuando pasa la pausa', async () => {
    const transport = vi.fn(async () => null)
    const { instancia, clock } = reporter({ transport })

    await instancia.report(evento({ errorName: 'E1' }))
    clock.valor += TRANSPORT_PAUSE_MS
    await instancia.report(evento({ errorName: 'E2' }))
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('cierra el canal para la sesión tras el segundo fallo consecutivo', async () => {
    const transport = vi.fn(async () => null)
    const { instancia, clock } = reporter({ transport })

    await instancia.report(evento({ errorName: 'E1' }))
    clock.valor += TRANSPORT_PAUSE_MS
    await instancia.report(evento({ errorName: 'E2' }))
    expect(transport).toHaveBeenCalledTimes(2)

    clock.valor += TRANSPORT_PAUSE_MS * 10
    await instancia.report(evento({ errorName: 'E3' }))
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('un éxito reinicia el contador de fallos', async () => {
    let respuesta: number | null = null
    const transport = vi.fn(async () => respuesta)
    const { instancia, clock } = reporter({ transport })

    await instancia.report(evento({ errorName: 'E1' }))
    clock.valor += TRANSPORT_PAUSE_MS

    respuesta = 204
    await instancia.report(evento({ errorName: 'E2' }))

    respuesta = null
    await instancia.report(evento({ errorName: 'E3' }))
    expect(transport).toHaveBeenCalledTimes(3)

    // Sigue siendo el «primer» fallo: pausa, no cierre.
    clock.valor += TRANSPORT_PAUSE_MS
    await instancia.report(evento({ errorName: 'E4' }))
    expect(transport).toHaveBeenCalledTimes(4)
  })

  it('trata un 5xx como fallo de transporte', async () => {
    const transport = vi.fn(async () => 503)
    const { instancia, clock } = reporter({ transport })

    await instancia.report(evento({ errorName: 'E1' }))
    clock.valor += TRANSPORT_PAUSE_MS - 1
    await instancia.report(evento({ errorName: 'E2' }))
    expect(transport).toHaveBeenCalledTimes(1)
  })

  // Un 400 es un contrato mal armado por el cliente: reintentar no lo arregla,
  // pero tampoco es señal de que el canal esté caído.
  it('descarta un 4xx sin abrir el breaker', async () => {
    const transport = vi.fn(async () => 400)
    const { instancia } = reporter({ transport })

    await instancia.report(evento({ errorName: 'E1' }))
    await instancia.report(evento({ errorName: 'E2' }))
    expect(transport).toHaveBeenCalledTimes(2)
  })
})

describe('createClientErrorReporter — cambio de cuenta', () => {
  // Un evento capturado antes del logout no puede terminar atribuido a la
  // cuenta que inició sesión después.
  it('descarta un evento cuya cuenta cambió antes del envío', async () => {
    let cuenta: string | null = 'cuenta-a'
    let resolver: (value: number) => void = () => {}
    const transport = vi.fn(
      () => new Promise<number>((resolve) => {
        resolver = resolve
      }),
    )
    const { instancia } = reporter({ transport, currentAccountId: () => cuenta })

    const enVuelo = instancia.report(evento())
    cuenta = 'cuenta-b'
    resolver(204)
    await enVuelo

    expect(instancia.stats().discardedByAccountChange).toBe(1)
  })

  it('el cambio de cuenta no reinicia el cap de la pestaña', async () => {
    let cuenta: string | null = 'cuenta-a'
    const { instancia, transport } = reporter({ currentAccountId: () => cuenta })

    for (let i = 0; i < MAX_REPORTS_PER_TAB; i += 1) {
      await instancia.report(evento({ errorName: `E${i}` }))
    }
    cuenta = 'cuenta-b'
    await instancia.report(evento({ errorName: 'posterior' }))

    expect(transport).toHaveBeenCalledTimes(MAX_REPORTS_PER_TAB)
  })
})

describe('createClientErrorReporter — envío no intentado', () => {
  // Cuando no hay token, el envío ni siquiera ocurre. Tratarlo como fallo de
  // transporte cerraría el canal por un problema de sesión, no del endpoint —
  // y con el refresh token vencido `currentAccountId()` sigue devolviendo la
  // cuenta, así que el guard de sesión no lo atrapa.
  it('no abre el breaker cuando el envío no se intentó', async () => {
    const transport = vi.fn(async () => 'not_attempted' as const)
    const { instancia, clock } = reporter({ transport })

    await instancia.report(evento({ errorName: 'E1' }))
    clock.valor += 1
    await instancia.report(evento({ errorName: 'E2' }))
    clock.valor += 1
    await instancia.report(evento({ errorName: 'E3' }))

    expect(transport).toHaveBeenCalledTimes(3)
    expect(instancia.stats().closed).toBe(false)
  })

  it('no consume un intento del cap', async () => {
    const transport = vi.fn(async () => 'not_attempted' as const)
    const { instancia } = reporter({ transport })

    await instancia.report(evento())
    expect(instancia.stats().attempts).toBe(0)
  })

  // Si consumiera la firma, el mismo error no podría reportarse nunca más en
  // la pestaña aunque la sesión se recuperara.
  it('no consume la firma: el mismo evento se puede reportar al recuperarse', async () => {
    let respuesta: 'not_attempted' | number = 'not_attempted'
    const transport = vi.fn(async () => respuesta)
    const { instancia } = reporter({ transport })

    await instancia.report(evento())
    respuesta = 204
    await instancia.report(evento())

    expect(transport).toHaveBeenCalledTimes(2)
    expect(instancia.stats().sent).toBe(1)
  })
})

describe('createClientErrorReporter — la cuenta se verifica antes de enviar', () => {
  // El guard posterior al await no podía evitar nada: el servidor estampa el
  // user_id del token que el transporte resuelve, así que si la cuenta cambió
  // durante el vuelo la fila ya quedó bajo la cuenta equivocada.
  it('no envía si la cuenta cambió entre la captura y el envío', async () => {
    let cuenta: string | null = 'cuenta-a'
    const transport = vi.fn(async () => 204)
    const { instancia } = reporter({
      transport,
      currentAccountId: () => {
        const actual = cuenta
        // Simula el cambio de sesión ocurrido justo antes del envío.
        cuenta = 'cuenta-b'
        return actual
      },
    })

    await instancia.report(evento())

    expect(transport).not.toHaveBeenCalled()
    expect(instancia.stats().discardedByAccountChange).toBe(1)
  })

  it('envía normalmente cuando la cuenta se mantiene', async () => {
    const { instancia, transport } = reporter()
    await instancia.report(evento())
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
