# Dev Testing Commands

Guia rapida para probar la app en dev con Gemini y Playwright.

## Flujo recomendado coach

1. Levantar la app:

```bash
npm run dev
```

2. Primera corrida, o cuando quieras ver el browser:

```bash
npm run e2e:dev:headed
```

Si no hay sesion guardada, Playwright abre el browser y espera que hagas login. Despues guarda `scripts/.e2e-auth-state.json`, que esta ignorado por git.

3. Prueba rapida, sin week creator largo:

```bash
npm run e2e:dev:quick
```

4. Suite dev completa, sin aplicar propuestas:

```bash
npm run e2e:dev
```

5. Suite dev completa aplicando propuestas:

```bash
npm run e2e:dev:apply
```

Usar este comando cuando quieras probar el flujo real de aceptar cambios. Puede modificar datos locales/dev.

6. Suite con export de Beta Quality:

```bash
npm run e2e:dev:quality
```

## Plan Builder

Suite segura, no guarda un plan nuevo. Revisa auth, rutas, wizard hasta resumen, builder existente y panel de debug:

```bash
npm run e2e:plan
```

Primera corrida o cuando quieras ver el browser:

```bash
npm run e2e:plan:headed
```

Generar un plan nuevo con Gemini, sin aceptarlo:

```bash
npm run e2e:plan:generate
```

Generar y aceptar el plan. Este comando modifica datos dev/locales y puede reemplazar el plan activo:

```bash
npm run e2e:plan:accept
```

## Checks tecnicos

Lint:

```bash
npm run lint
```

Build:

```bash
npm run build
```

Tests unitarios:

```bash
npm run test
```

Auditoria de prompts:

```bash
npm run audit:prompt
```

Load test secuencial del week creator:

```bash
npm run loadtest:week-creator
```

## Probar otra URL

Para apuntar la suite E2E a otro entorno:

```bash
E2E_BASE_URL=http://localhost:8888 npm run e2e:dev
```

Plan Builder contra otro entorno:

```bash
E2E_BASE_URL=http://localhost:8888 npm run e2e:plan
```

Cuando dev este estable, se puede hacer un smoke test contra produccion:

```bash
E2E_BASE_URL=https://TU_URL_DE_PROD npm run e2e:dev:quick
```

Primero estabilizar en dev; prod conviene usarlo solo como smoke test final de build, env vars, auth y Netlify.
