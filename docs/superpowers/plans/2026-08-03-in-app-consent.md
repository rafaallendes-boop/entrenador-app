# Consentimiento in-app versionado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar de forma versionada y auditable qué documentos legales aceptó cada cuenta y cuándo, bloqueando la app y la sincronización de Whoop mientras falte consentimiento vigente.

**Architecture:** El texto legal deja de ser componente y pasa a ser artefacto de datos inmutable por publicación. Un manifiesto de datos puros declara la versión vigente de cada documento y lo comparten cliente y funciones de Netlify. Las aceptaciones viven en un log append-only en Supabase (`017`) con espejo Dexie (v19) que solo guarda filas devueltas por el servidor.

**Tech Stack:** React + TypeScript + Vite + Dexie + Supabase + Vitest. Funciones de Netlify en el mismo repo.

**Spec:** `docs/superpowers/specs/2026-08-02-in-app-consent-design.md`

**Base:** `33d585f`

## Global Constraints

- **`consentDocuments.ts` es datos puros.** No lee `import.meta.env` ni `process.env`, no importa Dexie, Zustand ni nada de navegador. Si lo hiciera, las funciones de Netlify no podrían importarlo.
- **La resolución de la bandera vive en adaptadores separados**, uno por entorno, con la misma firma.
- **Append-only:** `user_consents` no declara políticas de `update` ni `delete`. Los artefactos legales publicados no se editan nunca.
- **Una versión es un identificador de publicación y no se reutiliza jamás.** Gramática: `/^\d{4}-\d{2}-\d{2}(?:-r(?:[2-9]|[1-9]\d+))?$/`.
- **El espejo Dexie solo guarda filas que Supabase devolvió**, nunca objetos construidos por el cliente, y **toda lectura filtra por `userId`**.
- **El hash es una verificación de integridad de test, no comportamiento de runtime.** La app nunca hashea nada; el ledger guarda los hashes y un test los verifica.
- **Los commits los hace el owner.** No ejecutar `git add` ni `git commit`. Los pasos "Commit" describen el commit que corresponde; el agente para ahí.
- **Comando de test:** `npx vitest run <ruta>` — `--silent` rompe cuando se le pasan rutas.
- **Verificación completa:** `npx tsc -b`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`.

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/services/legal/publications/*.ts` | Artefactos inmutables, uno por publicación | 1 |
| `src/services/legal/legalDocumentContent.ts` | Tipo `LegalDocumentContent` (bloques) | 1 |
| `src/services/legal/consentDocuments.ts` | Manifiesto: documentos, versión vigente, ledger. **Datos puros** | 1 |
| `src/components/legal/LegalDocumentRenderer.tsx` | Renderiza cualquier artefacto | 1 |
| `src/pages/TermsPage.tsx` y hermanas | Selector delgado de la publicación vigente | 1 |
| `supabase/017_user_consents.sql` | Tabla, trigger de timestamp, RLS | 2 |
| `src/db/db.ts` | Dexie v19 + tabla `consentAcceptances` | 3 |
| `src/services/legal/consentService.ts` | `getMissingConsents`, `acceptConsent`, hidratación | 4 |
| `src/services/legal/consentFlag.ts` | Adaptador de bandera del cliente | 4 |
| `src/components/legal/ConsentGate.tsx` | Gate + pantalla de aceptación | 5 |
| `src/components/legal/ConsentAccountActions.tsx` | Cerrar sesión, exportar y borrar sin aceptar | 5 |
| `netlify/functions/_shared/consentFlag.ts` | Adaptador de bandera del servidor | 6 |
| `netlify/functions/_shared/consentEnforcement.ts` | Comprobación compartida por los cuatro accesos | 6 |
| `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md` | Estado y rollout | 7 |

---

## Task 1: Artefactos legales, manifiesto y ledger

**Files:**
- Create: `src/services/legal/legalDocumentContent.ts`
- Create: `src/services/legal/publications/terms.2026-07-13.ts` (y las tres hermanas)
- Create: `src/services/legal/consentDocuments.ts`
- Create: `src/components/legal/LegalDocumentRenderer.tsx`
- Delete: `src/constants/legal.ts` (deja de ser una falsa fuente productiva)
- Modify: `src/pages/TermsPage.tsx`, `PrivacyPage.tsx`, `HealthDisclaimerPage.tsx`, `WhoopDisclaimerPage.tsx`
- Test: `src/services/legal/__tests__/consentDocuments.test.ts`, `src/services/legal/__tests__/legalPublicationIntegrity.test.ts`, `src/components/legal/__tests__/legalTextParity.test.tsx`, `src/components/legal/__tests__/LegalDocumentRenderer.test.tsx`

**Interfaces:**
- Produces: `LegalDocumentContent`, `CONSENT_DOCUMENTS`, `CONSENT_LEDGER`, `ConsentDocumentId = 'terms' | 'privacy' | 'health' | 'whoop_biometric'`, `getCurrentVersion(id): string`, `getPublication(id, version): LegalDocumentContent`.

**Contexto que el implementador necesita.** Hoy el texto vive en TSX editable: `TermsPage.tsx:14` exporta `TermsDocument` y `LegalPageLayout` recibe `{ eyebrow, title, metaRoute, updatedAt, children }`. El `updatedAt` es un literal (`"2026-07-13"`) que **ya diverge** del `.md` en `docs/legal/`. Los `.md` son copia obsoleta: no son la fuente.

- [ ] **Step 1: Escribir el test de paridad de texto (rojo)**

Este test se escribe **antes** de migrar y captura el texto actual. Crear `src/components/legal/__tests__/legalTextParity.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import TermsPage from '../../../pages/TermsPage'

/**
 * Paridad de la migración TSX → artefacto de datos (spec §11). Congela que
 * mover la forma no cambió una coma del contenido. Se genera ANTES de migrar.
 */
/**
 * `textContent` solo no alcanza: un enlace migrado con el `href` equivocado o un
 * `<strong>` perdido darían el mismo texto plano. Se captura estructura
 * semántica: etiqueta, énfasis y destino.
 */
function renderedShape(ui: React.ReactElement): string {
  const { container } = render(<MemoryRouter>{ui}</MemoryRouter>)
  const lines: string[] = []
  container.querySelectorAll('h1, h2, h3, p, li').forEach((node) => {
    const parts: string[] = [`<${node.tagName.toLowerCase()}>`]
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) parts.push(`text:${text}`)
        return
      }
      const el = child as HTMLElement
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (el.tagName === 'A') parts.push(`link[${el.getAttribute('href')}]:${text}`)
      else if (el.tagName === 'STRONG') parts.push(`strong:${text}`)
      else if (text) parts.push(`text:${text}`)
    })
    lines.push(parts.join(' | '))
  })
  return lines.join('\n')
}

describe('paridad del texto legal migrado', () => {
  it('términos renderiza exactamente el mismo texto que antes de migrar', async () => {
    await expect(`${renderedShape(<TermsPage />)}\n`)
      .toMatchFileSnapshot('./__snapshots__/legalTextParity.terms.txt')
  })
})
```

Repetir el bloque `it` para `PrivacyPage`, `HealthDisclaimerPage` y `WhoopDisclaimerPage`, cada uno con su propio archivo de snapshot.

- [ ] **Step 2: Generar los snapshots de paridad sobre el código actual**

Run: `npx vitest run src/components/legal/__tests__/legalTextParity.test.tsx`
Expected: PASS, 4 snapshots escritos. **Desde acá está prohibido regenerarlos**: son la prueba de que la migración no tocó contenido.

- [ ] **Step 3: Definir el tipo de contenido**

Crear `src/services/legal/legalDocumentContent.ts`:

```ts
/** Bloque de un documento legal publicado. Datos, no JSX. */
export type LegalBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; spans: LegalSpan[] }
  | { kind: 'list'; items: LegalSpan[][] }

/** Fragmento con o sin enlace. El `href` es parte del compromiso, no decoración. */
export type LegalSpan =
  | { text: string }
  | { text: string; href: string }
  | { text: string; strong: true }

export interface LegalDocumentContent {
  title: string
  eyebrow: string
  blocks: LegalBlock[]
}
```

- [ ] **Step 4: Migrar el contenido a artefactos**

**Las versiones iniciales NO son todas la misma.** Salen del `updatedAt` que hoy declara cada página:

| Documento | Página | Versión inicial |
|---|---|---|
| `terms` | `TermsPage.tsx:20` | `2026-07-13` |
| `privacy` | `PrivacyPage.tsx:19` | `2026-07-13` |
| `health` | `HealthDisclaimerPage.tsx:10` | **`2026-06-20`** |
| `whoop_biometric` | `WhoopDisclaimerPage.tsx:10` | **`2026-07-07`** |

Los nombres de archivo y las constantes siguen esas fechas: `health.2026-06-20.ts` exporta `HEALTH_2026_06_20`, `whoop_biometric.2026-07-07.ts` exporta `WHOOP_2026_07_07`.

Crear un archivo por documento, con el nombre del titular **ya interpolado** (no `{controllerName}`; el valor literal publicado hoy es `'Rafael Allendes'`). No importar una constante compartida: cambiarla mutaría artefactos históricos. Ejemplo de forma:

```ts
import type { LegalDocumentContent } from '../legalDocumentContent'

/**
 * PUBLICACIÓN INMUTABLE. Este archivo no se edita nunca. Para cambiar el texto
 * se crea una publicación nueva con id nuevo y se actualiza el manifiesto.
 */
export const TERMS_2026_07_13: LegalDocumentContent = {
  title: 'Términos y Condiciones',
  eyebrow: 'Legal',
  blocks: [
    {
      kind: 'paragraph',
      spans: [
        { text: 'Titular del servicio:', strong: true },
        { text: ' Rafael Allendes. Si cambia la persona o entidad titular del servicio, esta sección y la Política de Privacidad se actualizarán antes de que el cambio produzca efectos para los usuarios.' },
      ],
    },
    // …resto del documento, transcrito literalmente desde el TSX actual
  ],
}
```

Transcribir el contenido completo de cada página actual. No reescribir ni corregir nada: es cambio de forma.

- [ ] **Step 5: Escribir el manifiesto (datos puros)**

Crear `src/services/legal/consentDocuments.ts`:

```ts
import type { LegalDocumentContent } from './legalDocumentContent'
import { TERMS_2026_07_13 } from './publications/terms.2026-07-13'
import { PRIVACY_2026_07_13 } from './publications/privacy.2026-07-13'
import { HEALTH_2026_06_20 } from './publications/health.2026-06-20'
import { WHOOP_2026_07_07 } from './publications/whoop_biometric.2026-07-07'

export type ConsentDocumentId = 'terms' | 'privacy' | 'health' | 'whoop_biometric'

/** Documentos exigidos al entrar. `whoop_biometric` se pide en su propio punto. */
export const ENTRY_DOCUMENT_IDS: readonly ConsentDocumentId[] = ['terms', 'privacy', 'health']

export interface ConsentPublication {
  version: string
  sha256: string
  content: LegalDocumentContent
}

export interface ConsentDocument {
  id: ConsentDocumentId
  route: string
  currentVersion: string
  /** Append-only: toda publicación que existió, incluidas las retiradas. */
  publications: readonly ConsentPublication[]
}

export const CONSENT_DOCUMENTS: readonly ConsentDocument[] = [
  {
    id: 'terms',
    route: '/terms',
    currentVersion: '2026-07-13',
    publications: [
      { version: '2026-07-13', sha256: 'PENDIENTE_STEP_7', content: TERMS_2026_07_13 },
    ],
  },
  {
    id: 'privacy',
    route: '/privacy',
    currentVersion: '2026-07-13',
    publications: [
      { version: '2026-07-13', sha256: 'PENDIENTE_STEP_7', content: PRIVACY_2026_07_13 },
    ],
  },
  {
    id: 'health',
    route: '/health-disclaimer',
    currentVersion: '2026-06-20',
    publications: [
      { version: '2026-06-20', sha256: 'PENDIENTE_STEP_7', content: HEALTH_2026_06_20 },
    ],
  },
  {
    id: 'whoop_biometric',
    route: '/whoop-disclaimer',
    currentVersion: '2026-07-07',
    publications: [
      { version: '2026-07-07', sha256: 'PENDIENTE_STEP_7', content: WHOOP_2026_07_07 },
    ],
  },
]

export function getDocument(id: ConsentDocumentId): ConsentDocument {
  const found = CONSENT_DOCUMENTS.find((doc) => doc.id === id)
  if (!found) throw new Error(`Documento de consentimiento inexistente: ${id}`)
  return found
}

export function getCurrentVersion(id: ConsentDocumentId): string {
  return getDocument(id).currentVersion
}

export function getPublication(id: ConsentDocumentId, version: string): ConsentPublication {
  const found = getDocument(id).publications.find((pub) => pub.version === version)
  if (!found) throw new Error(`Publicación inexistente: ${id}@${version}`)
  return found
}
```

`PENDIENTE_STEP_7` se reemplaza en el Step 7 con el hash real. Es el único valor provisorio del plan y desaparece dentro de la misma tarea.

- [ ] **Step 6: Escribir el test de integridad del ledger (rojo)**

Crear `src/services/legal/__tests__/legalPublicationIntegrity.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { CONSENT_DOCUMENTS, type ConsentPublication } from '../consentDocuments'

const VERSION_GRAMMAR = /^\d{4}-\d{2}-\d{2}(?:-r(?:[2-9]|[1-9]\d+))?$/

/**
 * Serialización canónica: incluye texto, `href` y marcas de énfasis, porque el
 * destino de un enlace es parte del compromiso legal y un hash de texto
 * colapsado lo perdería.
 */
function canonicalize(publication: ConsentPublication): string {
  return JSON.stringify(publication.content)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Conjunto histórico congelado como tripleta `documento@versión#hash`.
 *
 * Congelar solo los ids no alcanza: alguien podría editar un artefacto viejo y
 * actualizar su `sha256` en el manifiesto, y los dos tests seguirían verdes —
 * el de hash porque coincide con el valor nuevo, y el de conjunto porque el id
 * no cambió. Con el hash dentro de la tripleta, esa edición rompe acá.
 *
 * Los hashes se completan en el Step 7 junto con los del manifiesto.
 */
const FROZEN_PUBLICATIONS = [
  'health@2026-06-20#PENDIENTE_STEP_7',
  'privacy@2026-07-13#PENDIENTE_STEP_7',
  'terms@2026-07-13#PENDIENTE_STEP_7',
  'whoop_biometric@2026-07-07#PENDIENTE_STEP_7',
]

describe('integridad de las publicaciones legales', () => {
  const all = CONSENT_DOCUMENTS.flatMap((doc) =>
    doc.publications.map((pub) => ({ doc, pub })),
  )

  it('el conjunto histórico de publicaciones solo crece y su contenido no cambia', () => {
    expect(all.map(({ doc, pub }) => `${doc.id}@${pub.version}#${pub.sha256}`).sort())
      .toEqual(FROZEN_PUBLICATIONS)
  })

  it.each(all.map(({ doc, pub }) => [`${doc.id}@${pub.version}`, pub] as const))(
    '%s conserva el hash de su contenido',
    (_label, publication) => {
      expect(sha256(canonicalize(publication))).toBe(publication.sha256)
    },
  )

  it('cada versión respeta la gramática de identificador de publicación', () => {
    for (const { pub } of all) expect(pub.version).toMatch(VERSION_GRAMMAR)
  })

  it('ninguna versión se repite dentro de un documento', () => {
    for (const doc of CONSENT_DOCUMENTS) {
      const versions = doc.publications.map((pub) => pub.version)
      expect(new Set(versions).size).toBe(versions.length)
    }
  })

  it('la versión vigente de cada documento existe en su ledger', () => {
    for (const doc of CONSENT_DOCUMENTS) {
      expect(doc.publications.some((pub) => pub.version === doc.currentVersion)).toBe(true)
    }
  })
})
```

- [ ] **Step 7: Correr, tomar los hashes reales y fijarlos**

Run: `npx vitest run src/services/legal/__tests__/legalPublicationIntegrity.test.ts`
Expected: FAIL en los cuatro casos de hash, con el valor recibido en el mensaje.

Copiar cada hash recibido **en los dos lugares congelados**: al campo `sha256`
correspondiente en `consentDocuments.ts` y a la tripleta correspondiente de
`FROZEN_PUBLICATIONS` en el test, reemplazando todos los
`PENDIENTE_STEP_7`. Volver a correr: PASS. Si queda un placeholder, la tarea no
está terminada.

- [ ] **Step 8: Renderizador único**

Crear `src/components/legal/LegalDocumentRenderer.tsx`:

```tsx
import { Link } from 'react-router-dom'
import LegalPageLayout from './LegalPageLayout'
import type { LegalBlock, LegalSpan } from '../../services/legal/legalDocumentContent'
import { getDocument, getPublication, type ConsentDocumentId } from '../../services/legal/consentDocuments'

function renderSpan(span: LegalSpan, index: number) {
  if ('href' in span && span.href.startsWith('/')) {
    return <Link key={index} to={span.href}>{span.text}</Link>
  }
  if ('href' in span) return <a key={index} href={span.href}>{span.text}</a>
  if ('strong' in span) return <strong key={index}>{span.text}</strong>
  return <span key={index}>{span.text}</span>
}

function renderBlock(block: LegalBlock, index: number) {
  if (block.kind === 'heading') return <h2 key={index}>{block.text}</h2>
  if (block.kind === 'list') {
    return (
      <ul key={index}>
        {block.items.map((spans, itemIndex) => (
          <li key={itemIndex}>{spans.map(renderSpan)}</li>
        ))}
      </ul>
    )
  }
  return <p key={index}>{block.spans.map(renderSpan)}</p>
}

export default function LegalDocumentRenderer({ id }: { id: ConsentDocumentId }) {
  const document = getDocument(id)
  const publication = getPublication(id, document.currentVersion)

  return (
    <LegalPageLayout
      eyebrow={publication.content.eyebrow}
      title={publication.content.title}
      metaRoute={document.route}
      // El `updatedAt` sale del manifiesto, nunca de un literal en el TSX: si
      // salieran de dos lugares podrían discrepar, que es el bug de origen.
      updatedAt={document.currentVersion}
    >
      {publication.content.blocks.map(renderBlock)}
    </LegalPageLayout>
  )
}
```

- [ ] **Step 9: Adelgazar las cuatro páginas**

`src/pages/TermsPage.tsx` queda:

```tsx
import LegalDocumentRenderer from '../components/legal/LegalDocumentRenderer'

export default function TermsPage() {
  return <LegalDocumentRenderer id="terms" />
}
```

Igual para las otras tres con su `id`. Borrar los componentes `*Document` exportados y sus imports de `LEGAL_CONTROLLER_NAME` — el nombre ya está dentro del artefacto. Eliminar también `src/constants/legal.ts`: no puede quedar una constante que parezca fuente única pero no alimente los artefactos inmutables. Los tests de política apuntan al texto renderizado/publicado. Agregar una prueba de navegación que demuestre que los links internos cambian la location del `MemoryRouter`; el snapshot de `href` por sí solo no distingue `<Link>` de `<a>`.

- [ ] **Step 10: Verificar paridad**

Run: `npx vitest run src/components/legal/__tests__/legalTextParity.test.tsx`
Expected: PASS **sin regenerar snapshots**. Si falla, la transcripción del Step 4 perdió o cambió texto: arreglar el artefacto, nunca el snapshot.

- [ ] **Step 11: Verificar el conjunto**

Run: `npx tsc -b && npx vitest run src/services/legal/ src/components/legal/ src/pages/`
Expected: verde.

- [ ] **Step 12: Commit (ofrecer al owner)**

```bash
git add src/services/legal src/components/legal src/pages
git commit -m "refactor(legal): publish legal documents as immutable versioned artifacts"
```

---

## Task 2: Migración Supabase `017`

**Files:**
- Create: `supabase/017_user_consents.sql`
- Test: `src/services/legal/__tests__/consentMigrationDrift.test.ts`

**Interfaces:**
- Produces: tabla `public.user_consents` con columnas `id`, `user_id`, `document`, `version`, `accepted_at`.

**Contexto.** Las migraciones son de **aplicación manual**: escribir el `.sql` no es aplicarlo. El estilo del proyecto está en `supabase/015_session_templates.sql`. Esta migración **no lleva FK a `auth.users`**, a diferencia de `015` — es deliberado (spec §3.1 y §8.1).

- [ ] **Step 1: Escribir la migración**

Crear `supabase/017_user_consents.sql`:

```sql
-- 017_user_consents.sql — Consentimiento in-app versionado.
-- Log append-only por cuenta. Sin políticas de update/delete: lo que no está
-- permitido no ocurre. Sin FK a auth.users a propósito — el alcance del borrado
-- de cuenta es una decisión legal abierta (spec §8.1), y fijar `cascade` aquí la
-- respondería por adelantado.
-- Spec: docs/superpowers/specs/2026-08-02-in-app-consent-design.md

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

create index if not exists user_consents_user_document_idx
  on public.user_consents (user_id, document);

-- `default now()` solo aplica si el cliente omite la columna. El trigger la
-- sobrescribe siempre: el registro legal no puede quedar fechado por quien
-- consiente.
create or replace function public.force_consent_timestamp() returns trigger as $$
begin
  new.accepted_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_consents_force_timestamp on public.user_consents;
create trigger user_consents_force_timestamp
  before insert on public.user_consents
  for each row execute function public.force_consent_timestamp();

alter table public.user_consents enable row level security;

drop policy if exists user_consents_select_own on public.user_consents;
create policy user_consents_select_own on public.user_consents
  for select using (auth.uid() = user_id);

drop policy if exists user_consents_insert_own on public.user_consents;
create policy user_consents_insert_own on public.user_consents
  for insert with check (auth.uid() = user_id);

-- Deliberadamente NO se declaran políticas de update ni delete.
```

- [ ] **Step 2: Guard de drift entre migración y código**

Crear `src/services/legal/__tests__/consentMigrationDrift.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MIGRATION = readFileSync('supabase/017_user_consents.sql', 'utf-8')

describe('017_user_consents', () => {
  it('no declara políticas de update ni delete', () => {
    expect(MIGRATION).not.toMatch(/for\s+update/i)
    expect(MIGRATION).not.toMatch(/for\s+delete/i)
  })

  it('fuerza el timestamp con trigger, no solo con default', () => {
    expect(MIGRATION).toMatch(/before insert on public\.user_consents/i)
  })

  it('no ata el borrado de cuenta con una FK', () => {
    expect(MIGRATION).not.toMatch(/references auth\.users/i)
  })

  it('impide duplicados por reintento', () => {
    expect(MIGRATION).toMatch(/unique \(user_id, document, version\)/i)
  })
})
```

- [ ] **Step 3: Verificar**

Run: `npx vitest run src/services/legal/__tests__/consentMigrationDrift.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit (ofrecer al owner)**

```bash
git add supabase/017_user_consents.sql src/services/legal/__tests__/consentMigrationDrift.test.ts
git commit -m "feat(consent): add append-only user_consents migration"
```

**Recordatorio operativo:** `017` queda escrita, **no aplicada**. Aplicarla es paso del rollout (Task 7) y lo hace el owner.

---

## Task 3: Dexie v19 — espejo `consentAcceptances`

**Files:**
- Modify: `src/db/db.ts` (declaración de tabla y `this.version(19)`)
- Modify: `src/db/athleteScopedTables.ts` (tabla account-scoped dentro del manifiesto transaccional)
- Modify: `src/services/appMaintenance.ts:144` (borrado local account-scoped)
- Create: `src/types/consent.ts`
- Test: `src/db/__tests__/consentAcceptancesUpgrade.test.ts`
- Test: `src/db/__tests__/athleteScopedTables.test.ts`, `src/services/__tests__/appMaintenance.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ConsentAcceptance { id: string; userId: string; document: ConsentDocumentId; version: string; acceptedAt: string }` y `db.consentAcceptances`.

**Contexto.** La última versión es `this.version(18)` en `src/db/db.ts:239`. Las tablas se declaran como campos de clase entre las líneas 8 y 24. Regla del proyecto: todo cambio de schema exige test de upgrade **real**, con el patrón `db.close(); await db.delete(); await db.open()` por test.

- [ ] **Step 1: Escribir el test de upgrade (rojo)**

**Ojo con el error clásico:** borrar la base y abrirla en v19 no prueba un
upgrade, prueba una instalación limpia. El upgrade real exige abrir una Dexie
**legacy en v18**, sembrar datos, cerrarla, y recién entonces abrir
`EntrenadorDB` para que Dexie corra la migración sobre datos existentes.

Crear `src/db/__tests__/consentAcceptancesUpgrade.test.ts`:

```ts
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../db'

const DB_NAME = db.name

/** Abre la base con el schema v18 tal como existía antes de esta entrega. */
async function openLegacyV18() {
  const legacy = new Dexie(DB_NAME)
  legacy.version(18).stores({
    sessions: 'id, date, weekStartDate, type, status',
    sessionTemplates: 'id, kind, updatedAt, name',
  })
  await legacy.open()
  return legacy
}

describe('Dexie v19 — upgrade real desde v18', () => {
  beforeEach(async () => {
    db.close()
    await Dexie.delete(DB_NAME)
  })

  afterEach(() => {
    db.close()
  })

  it('migra una base v18 con datos sin perderlos', async () => {
    const legacy = await openLegacyV18()
    await legacy.table('sessionTemplates').put({
      id: 'tpl-1', kind: 'strength', updatedAt: 1, name: 'Fuerza base',
    })
    legacy.close()

    await db.open()

    expect(db.verno).toBe(19)
    expect(db.consentAcceptances).toBeDefined()
    const survived = await db.sessionTemplates.get('tpl-1')
    expect(survived?.name).toBe('Fuerza base')
  })

  it('el índice compuesto impide duplicar la misma aceptación', async () => {
    await db.open()
    const row = {
      id: 'row-1',
      userId: 'user-1',
      document: 'terms' as const,
      version: '2026-07-13',
      acceptedAt: '2026-08-03T10:00:00.000Z',
    }
    await db.consentAcceptances.put(row)
    await expect(db.consentAcceptances.add({ ...row, id: 'row-2' })).rejects.toThrow()
  })

  it('separa aceptaciones por cuenta en el mismo dispositivo', async () => {
    await db.open()
    await db.consentAcceptances.bulkPut([
      { id: 'a', userId: 'user-1', document: 'terms', version: '2026-07-13', acceptedAt: '2026-08-03T10:00:00.000Z' },
      { id: 'b', userId: 'user-2', document: 'terms', version: '2026-07-13', acceptedAt: '2026-08-03T10:00:00.000Z' },
    ])

    const mine = await db.consentAcceptances.where('userId').equals('user-1').toArray()
    expect(mine).toHaveLength(1)
    expect(mine[0]!.id).toBe('a')
  })
})
```

Si el `stores` de v18 que copiaste no coincide con el real, el test falla al
abrir: leé `src/db/db.ts:239` y copiá el bloque exacto.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/db/__tests__/consentAcceptancesUpgrade.test.ts`
Expected: FAIL — `db.consentAcceptances` es `undefined` y `db.verno` es 18.

- [ ] **Step 3: Definir el tipo**

Crear `src/types/consent.ts`:

```ts
import type { ConsentDocumentId } from '../services/legal/consentDocuments'

/**
 * Espejo local de una aceptación CONFIRMADA por el servidor. Nunca se
 * construye en el cliente: siempre proviene de una fila devuelta por Supabase.
 */
export interface ConsentAcceptance {
  /** `id` remoto: hace el espejo trazable fila a fila. */
  id: string
  userId: string
  document: ConsentDocumentId
  version: string
  /** ISO del servidor, tal como vino. */
  acceptedAt: string
}
```

- [ ] **Step 4: Agregar la tabla y la versión**

En `src/db/db.ts`, junto a las otras declaraciones de tabla (líneas 8-24):

```ts
  consentAcceptances!: Table<ConsentAcceptance, string>
```

con `import type { ConsentAcceptance } from '../types/consent'` arriba. Y después del bloque `this.version(18)`:

```ts
    // v19 — espejo local de consentimientos confirmados por el servidor.
    // El índice es único: el duplicado ya lo impide el `unique` remoto, y acá
    // evita que una hidratación repetida cree filas paralelas.
    this.version(19).stores({
      consentAcceptances: 'id, userId, &[userId+document+version]',
    })
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run src/db/__tests__/consentAcceptancesUpgrade.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verificar que no se rompió el resto del schema**

**`consentAcceptances` es account-scoped y entra al borrado local.** En
`src/db/athleteScopedTables.ts`, agregarla primero a
`getAccountScopedTables()`. `clearAllLocalAppData()` abre una transacción con
`getAllLocalTables()`; intentar limpiar una tabla ausente de ese manifiesto
haría fallar la transacción. Actualizar `athleteScopedTables.test.ts` para
esperar `['sessionTemplates', 'consentAcceptances']`.

Después, en `src/services/appMaintenance.ts:144`, donde se limpian
explícitamente las tablas de cuenta (`sessionTemplates` entre ellas), agregar:

```ts
    await db.consentAcceptances.clear()
```

Agregar `consentAcceptances` al mock de `appMaintenance.test.ts` y verificar que
el borrado completo llama `clear()`. Sin eso, cerrar sesión o cambiar de cuenta dejaría el espejo de la cuenta
anterior en el dispositivo. El filtro por `userId` de las lecturas evita que
abra el gate equivocado, pero dejar evidencia ajena en el disco de otra persona
no se arregla con un filtro.

En cambio, `consentAcceptances` **no se agrega** a `exportAppData` ni a `parseAppDataExport`. El espejo se reconstruye desde Supabase por hidratación (Task 4), así que exportarlo produciría una segunda copia de la evidencia sin la autoridad del servidor — y peor, una copia importable desde un backup manipulado. Agregar un test que lo congele en `src/services/__tests__/dataExportLibraryRef.test.ts` o un archivo hermano:

```ts
it('el espejo de consentimientos no viaja en el backup', async () => {
  const { json } = await exportAppData()
  expect(Object.keys(JSON.parse(json).tables)).not.toContain('consentAcceptances')
})
```

Run: `npx vitest run src/db/ src/services/__tests__/dataExport*.test.ts && npx tsc -b`
Expected: verde.

- [ ] **Step 7: Commit (ofrecer al owner)**

```bash
git add src/db/db.ts src/db/athleteScopedTables.ts src/types/consent.ts \
  src/services/appMaintenance.ts src/db/__tests__/consentAcceptancesUpgrade.test.ts \
  src/db/__tests__/athleteScopedTables.test.ts src/services/__tests__/appMaintenance.test.ts
git commit -m "feat(consent): mirror confirmed consents in Dexie v19"
```

---

## Task 4: Servicio de consentimiento e hidratación

**Files:**
- Create: `src/services/legal/consentService.ts`
- Create: `src/services/legal/consentFlag.ts`
- Test: `src/services/legal/__tests__/consentService.test.ts`

**Interfaces:**
- Consumes: `CONSENT_DOCUMENTS`, `ENTRY_DOCUMENT_IDS`, `getCurrentVersion` (Task 1); `db.consentAcceptances`, `ConsentAcceptance` (Task 3); `supabase` de `src/services/auth.ts` (puede ser `null` si no está configurado).
- Produces:
  - `getMissingConsents(userId: string, ids?: readonly ConsentDocumentId[]): Promise<ConsentDocumentId[]>`
  - `hydrateConsents(userId: string): Promise<{ ok: boolean }>`
  - `acceptConsent(userId: string, id: ConsentDocumentId): Promise<{ ok: boolean }>`
  - `isConsentEnforcementEnabled(): boolean` (en `consentFlag.ts`)

- [ ] **Step 1: Escribir los tests (rojo)**

Crear `src/services/legal/__tests__/consentService.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../../db/db'
import { acceptConsent, getMissingConsents, hydrateConsents } from '../consentService'
import { getCurrentVersion } from '../consentDocuments'

const USER = 'user-1'

/**
 * Se sustituye el cliente de Supabase, NO funciones del propio módulo bajo
 * prueba: en ESM, `vi.spyOn` sobre el módulo que se está testeando no
 * intercepta las llamadas internas, porque el módulo ya resolvió sus
 * referencias. Mockear el borde real es lo único que funciona.
 */
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
// `vi.mock` se eleva por encima de las declaraciones del módulo, así que la
// referencia tiene que crearse dentro de `vi.hoisted` o queda `undefined` al
// evaluarse la factory.
vi.mock('../../auth', () => ({ supabase: { from: (...args: unknown[]) => from(...args) } }))

function setRemoteRows(rows: unknown[]) {
  from.mockReturnValue({
    select: () => ({ eq: async () => ({ data: rows, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: rows[0], error: null }) }) }),
  })
}

function setRemoteFailure() {
  from.mockReturnValue({
    select: () => ({ eq: async () => ({ data: null, error: { code: '500' } }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '500' } }) }) }),
  })
}

/** Insert que choca con el unique, con la fila ya existente en el select. */
function setRemoteConflict(existing: unknown[]) {
  from.mockReturnValue({
    select: () => ({ eq: async () => ({ data: existing, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505' } }) }) }),
  })
}

async function seedLocal(userId: string, document: 'terms' | 'privacy' | 'health', version: string) {
  await db.consentAcceptances.put({
    id: `${userId}-${document}-${version}`,
    userId,
    document,
    version,
    acceptedAt: '2026-08-03T10:00:00.000Z',
  })
}

describe('consentService', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    db.close()
  })

  it('sin aceptaciones, faltan los tres documentos de entrada', async () => {
    expect(await getMissingConsents(USER)).toEqual(['terms', 'privacy', 'health'])
  })

  it('una aceptación local vigente saca ese documento de la lista', async () => {
    await seedLocal(USER, 'terms', getCurrentVersion('terms'))
    expect(await getMissingConsents(USER)).toEqual(['privacy', 'health'])
  })

  it('una aceptación de OTRA cuenta no abre el gate', async () => {
    await seedLocal('otra-cuenta', 'terms', getCurrentVersion('terms'))
    expect(await getMissingConsents(USER)).toContain('terms')
  })

  it('una versión distinta a la vigente no cuenta', async () => {
    await seedLocal(USER, 'terms', '2026-01-01')
    expect(await getMissingConsents(USER)).toContain('terms')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/legal/__tests__/consentService.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar lectura y estado vigente**

Crear `src/services/legal/consentService.ts`:

```ts
import { db } from '../../db/db'
import { supabase } from '../auth'
import {
  ENTRY_DOCUMENT_IDS,
  getCurrentVersion,
  type ConsentDocumentId,
} from './consentDocuments'
import type { ConsentAcceptance } from '../../types/consent'

const TABLE = 'user_consents'

/**
 * Comparación por PERTENENCIA, no por orden: se exige exactamente la versión
 * vigente. Sin `MAX`, sin parseo de fechas. Así una reversión a un texto
 * anterior —que recibe id nuevo— vuelve a pedirse.
 */
export async function getMissingConsents(
  userId: string,
  ids: readonly ConsentDocumentId[] = ENTRY_DOCUMENT_IDS,
): Promise<ConsentDocumentId[]> {
  // Filtrar por userId es obligatorio: Dexie es local al dispositivo y
  // compartida entre cuentas.
  const rows = await db.consentAcceptances.where('userId').equals(userId).toArray()
  const accepted = new Map<string, Set<string>>()
  for (const row of rows) {
    const versions = accepted.get(row.document) ?? new Set<string>()
    versions.add(row.version)
    accepted.set(row.document, versions)
  }

  return ids.filter((id) => !accepted.get(id)?.has(getCurrentVersion(id)))
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/services/legal/__tests__/consentService.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Escribir los tests de hidratación y aceptación (rojo)**

Agregar al mismo archivo:

```ts
  it('hidrata desde Supabase cuando falta en local', async () => {
    const rows = [{
      id: 'remote-1',
      user_id: USER,
      document: 'terms',
      version: getCurrentVersion('terms'),
      accepted_at: '2026-08-03T10:00:00.000Z',
    }]
    setRemoteRows(rows)

    expect(await hydrateConsents(USER)).toEqual({ ok: true })
    expect(await getMissingConsents(USER)).toEqual(['privacy', 'health'])
  })

  it('una hidratación fallida no espeja nada y se reporta', async () => {
    setRemoteFailure()

    expect(await hydrateConsents(USER)).toEqual({ ok: false })
    expect(await db.consentAcceptances.count()).toBe(0)
  })

  it('un error remoto al aceptar no espeja la aceptación', async () => {
    setRemoteFailure()

    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: false })
    expect(await db.consentAcceptances.count()).toBe(0)
    expect(await getMissingConsents(USER)).toContain('terms')
  })

  it('un insert exitoso espeja la fila DEVUELTA, no la enviada', async () => {
    const version = getCurrentVersion('terms')
    setRemoteRows([{
      id: 'remote-9',
      user_id: USER,
      document: 'terms',
      version,
      // El servidor fecha con su reloj; el cliente nunca envía este valor.
      accepted_at: '2030-01-01T00:00:00.000Z',
    }])

    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: true })
    const stored = await db.consentAcceptances.get('remote-9')
    expect(stored?.acceptedAt).toBe('2030-01-01T00:00:00.000Z')
  })

  it('un 23505 con la fila exacta presente es idempotente', async () => {
    const version = getCurrentVersion('terms')
    setRemoteConflict([{
      id: 'remote-1', user_id: USER, document: 'terms', version,
      accepted_at: '2026-08-03T10:00:00.000Z',
    }])

    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: true })
    expect(await getMissingConsents(USER)).not.toContain('terms')
  })

  it('un 23505 SIN la fila exacta no se espeja: el conflicto era de otra cosa', async () => {
    setRemoteConflict([{
      id: 'remote-1', user_id: USER, document: 'terms', version: '2020-01-01',
      accepted_at: '2026-08-03T10:00:00.000Z',
    }])

    expect(await acceptConsent(USER, 'terms')).toEqual({ ok: false })
    expect(await getMissingConsents(USER)).toContain('terms')
  })

  it('descarta filas remotas de otra cuenta al hidratar', async () => {
    setRemoteRows([{
      id: 'ajena', user_id: 'otra-cuenta', document: 'terms',
      version: getCurrentVersion('terms'), accepted_at: '2026-08-03T10:00:00.000Z',
    }])

    expect(await hydrateConsents(USER)).toEqual({ ok: true })
    expect(await db.consentAcceptances.count()).toBe(0)
    expect(await getMissingConsents(USER)).toContain('terms')
  })
```

- [ ] **Step 6: Implementar hidratación y aceptación**

Agregar a `consentService.ts`:

```ts
interface RemoteRow {
  id: string
  user_id: string
  document: string
  version: string
  accepted_at: string
}

function toAcceptance(row: RemoteRow): ConsentAcceptance {
  return {
    id: row.id,
    userId: row.user_id,
    document: row.document as ConsentDocumentId,
    version: row.version,
    acceptedAt: row.accepted_at,
  }
}

/** Aislada para poder sustituirla en test sin tocar la red. */
export async function fetchRemoteConsents(
  userId: string,
): Promise<{ ok: boolean; rows: RemoteRow[] }> {
  if (!supabase) return { ok: false, rows: [] }
  const { data, error } = await supabase.from(TABLE).select('*').eq('user_id', userId)
  if (error) return { ok: false, rows: [] }
  return { ok: true, rows: (data ?? []) as RemoteRow[] }
}

/** Aislada por el mismo motivo. `conflict` distingue el 23505 de otros errores. */
export async function insertRemoteConsent(
  userId: string,
  document: ConsentDocumentId,
  version: string,
): Promise<{ ok: boolean; row?: RemoteRow; conflict: boolean }> {
  if (!supabase) return { ok: false, conflict: false }
  const { data, error } = await supabase
    .from(TABLE)
    // `accepted_at` NO se envía: lo fuerza el trigger del servidor.
    .insert({ user_id: userId, document, version })
    .select()
    .single()

  if (!error) return { ok: true, row: data as RemoteRow, conflict: false }
  return { ok: false, conflict: error.code === '23505' }
}

/**
 * El espejo no es autoridad: puede estar vacío en un dispositivo nuevo o tras
 * borrar IndexedDB. Sin esto, cambiar de dispositivo re-pediría algo ya
 * aceptado y ensuciaría el log con eventos que no son decisiones nuevas.
 */
export async function hydrateConsents(userId: string): Promise<{ ok: boolean }> {
  const remote = await fetchRemoteConsents(userId)
  if (!remote.ok) return { ok: false }

  const mine = remote.rows.filter((row) => row.user_id === userId)
  if (mine.length > 0) await db.consentAcceptances.bulkPut(mine.map(toAcceptance))
  return { ok: true }
}

/**
 * Una aceptación por documento, nunca en lote: un lote donde una fila choca con
 * 23505 y otra es nueva puede fallar entero y dejar el cliente espejando
 * aceptaciones inexistentes.
 */
export async function acceptConsent(
  userId: string,
  document: ConsentDocumentId,
): Promise<{ ok: boolean }> {
  const version = getCurrentVersion(document)
  const inserted = await insertRemoteConsent(userId, document, version)

  if (inserted.ok && inserted.row) {
    await db.consentAcceptances.put(toAcceptance(inserted.row))
    return { ok: true }
  }

  if (!inserted.conflict) return { ok: false }

  // 23505: la fila ya existía. El código de conflicto por sí solo no prueba qué
  // constraint chocó, así que se verifica la fila exacta antes de espejar.
  const remote = await fetchRemoteConsents(userId)
  if (!remote.ok) return { ok: false }
  const exact = remote.rows.find(
    (row) => row.user_id === userId && row.document === document && row.version === version,
  )
  if (!exact) return { ok: false }

  await db.consentAcceptances.put(toAcceptance(exact))
  return { ok: true }
}
```

- [ ] **Step 6b: Detectar si es re-aceptación**

Agregar a `consentService.ts`:

```ts
/**
 * Distingue primera aceptación de re-aceptación por versión nueva. Si de algún
 * documento faltante ya se aceptó una versión anterior, el texto cambió: la
 * pantalla debe decirlo en vez de leerse como un bug.
 */
export async function hasAnyPreviousAcceptance(
  userId: string,
  documents: readonly ConsentDocumentId[],
): Promise<boolean> {
  const rows = await db.consentAcceptances.where('userId').equals(userId).toArray()
  return documents.some((id) =>
    rows.some((row) => row.document === id && row.version !== getCurrentVersion(id)),
  )
}
```

- [ ] **Step 7: Adaptador de bandera del cliente**

Crear `src/services/legal/consentFlag.ts`:

```ts
/**
 * Adaptador de entorno. Vive separado de `consentDocuments.ts` porque el
 * manifiesto es datos puros: si leyera `import.meta.env` dejaría de ser
 * importable desde las funciones de Netlify.
 */
export function isConsentEnforcementEnabled(): boolean {
  return import.meta.env['VITE_CONSENT_GATE'] === 'true'
}
```

- [ ] **Step 8: Verificar**

Run: `npx vitest run src/services/legal/ && npx tsc -b`
Expected: verde, 11 tests en `consentService.test.ts`.

- [ ] **Step 9: Commit (ofrecer al owner)**

```bash
git add src/services/legal/consentService.ts src/services/legal/consentFlag.ts src/services/legal/__tests__/consentService.test.ts
git commit -m "feat(consent): add consent service with remote hydration"
```

---

## Task 5: `ConsentGate` y pantalla de aceptación

**Files:**
- Create: `src/components/legal/ConsentGate.tsx`
- Create: `src/components/legal/ConsentScreen.tsx`
- Create: `src/components/legal/ConsentAccountActions.tsx`
- Modify: `src/App.tsx` (envolver la app autenticada)
- Test: `src/components/legal/__tests__/ConsentGate.test.tsx`, `ConsentAccountActions.test.tsx`

**Interfaces:**
- Consumes: `getMissingConsents`, `hydrateConsents`, `acceptConsent` (Task 4); `isConsentEnforcementEnabled` (Task 4); `useAuthStore`.
- Produces: `<ConsentGate>{children}</ConsentGate>`.

**Contexto.** `AuthGate` (`src/components/auth/AuthGate.tsx:22`) es el patrón a seguir: lee `useAuthStore`, muestra un estado de carga y decide qué renderizar. `ConsentGate` se monta **dentro** de `AuthGate`, porque sin usuario no hay a quién pedirle consentimiento. Las rutas legales públicas (`App.tsx:347-350`) quedan fuera de ambos. El gate no puede encerrar la cuenta: durante `checking`, `missing` y `unavailable` mantiene una superficie restringida para cerrar sesión, exportar y borrar datos, sin abrir Settings ni funciones de producto.

- [ ] **Step 1: Escribir los tests (rojo)**

Crear `src/components/legal/__tests__/ConsentGate.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import ConsentGate from '../ConsentGate'
import * as service from '../../../services/legal/consentService'
import * as flag from '../../../services/legal/consentFlag'

const { authMock } = vi.hoisted(() => ({ authMock: { userId: 'user-1' } }))

vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: authMock.userId } }),
}))

describe('ConsentGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    authMock.userId = 'user-1'
    vi.spyOn(flag, 'isConsentEnforcementEnabled').mockReturnValue(true)
  })

  it('con la bandera apagada renderiza la app sin consultar nada', async () => {
    vi.spyOn(flag, 'isConsentEnforcementEnabled').mockReturnValue(false)
    const missing = vi.spyOn(service, 'getMissingConsents')

    render(<ConsentGate><p>app</p></ConsentGate>)

    expect(await screen.findByText('app')).toBeInTheDocument()
    expect(missing).not.toHaveBeenCalled()
  })

  it('sin nada faltante renderiza la app', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue([])
    render(<ConsentGate><p>app</p></ConsentGate>)
    expect(await screen.findByText('app')).toBeInTheDocument()
  })

  it('hidrata antes de pedir aceptación', async () => {
    const missing = vi.spyOn(service, 'getMissingConsents')
      .mockResolvedValueOnce(['terms'])
      .mockResolvedValueOnce([])
    const hydrate = vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: true })

    render(<ConsentGate><p>app</p></ConsentGate>)

    expect(await screen.findByText('app')).toBeInTheDocument()
    expect(hydrate).toHaveBeenCalledWith('user-1')
    expect(missing).toHaveBeenCalledTimes(2)
  })

  it('si la hidratación falla no ofrece aceptar: ofrece reintentar', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue(['terms'])
    vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: false })

    render(<ConsentGate><p>app</p></ConsentGate>)

    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /acepto/i })).not.toBeInTheDocument()
    expect(screen.queryByText('app')).not.toBeInTheDocument()
  })

  it('no reutiliza el estado de la cuenta anterior al cambiar de usuario', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue(['terms'])
    vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: true })
    vi.spyOn(service, 'hasAnyPreviousAcceptance').mockResolvedValue(false)

    const { rerender } = render(<ConsentGate><p>app</p></ConsentGate>)
    await waitFor(() => expect(screen.getByRole('button', { name: /acepto/i })).toBeInTheDocument())

    // Cambio REAL de cuenta: la app NO debe verse mientras se reevalúa.
    authMock.userId = 'user-2'
    rerender(<ConsentGate><p>app</p></ConsentGate>)
    expect(screen.queryByText('app')).not.toBeInTheDocument()
  })

  it('marca la re-aceptación cuando ya se aceptó una versión anterior', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue(['privacy'])
    vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: true })
    vi.spyOn(service, 'hasAnyPreviousAcceptance').mockResolvedValue(true)

    render(<ConsentGate><p>app</p></ConsentGate>)

    expect(await screen.findByText(/actualizamos nuestros documentos/i)).toBeInTheDocument()
  })

  it('tras hidratar y seguir faltando, muestra la pantalla de aceptación', async () => {
    vi.spyOn(service, 'getMissingConsents').mockResolvedValue(['terms', 'privacy'])
    vi.spyOn(service, 'hydrateConsents').mockResolvedValue({ ok: true })

    render(<ConsentGate><p>app</p></ConsentGate>)

    await waitFor(() => expect(screen.getByRole('button', { name: /acepto/i })).toBeInTheDocument())
    expect(screen.queryByText('app')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/legal/__tests__/ConsentGate.test.tsx`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementar el gate**

Crear `src/components/legal/ConsentGate.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { useAuthStore } from '../../store/useAuthStore'
import { isConsentEnforcementEnabled } from '../../services/legal/consentFlag'
import {
  getMissingConsents,
  hasAnyPreviousAcceptance,
  hydrateConsents,
} from '../../services/legal/consentService'
import type { ConsentDocumentId } from '../../services/legal/consentDocuments'
import ConsentScreen from './ConsentScreen'

/**
 * El estado lleva el `userId` al que corresponde. Sin eso, al cambiar de cuenta
 * el gate conserva `open` de la cuenta anterior hasta que corre el efecto
 * nuevo, y durante ese render la app queda visible para alguien que quizá no
 * aceptó nada.
 */
type GateState =
  | { status: 'checking'; userId: string | null }
  | { status: 'open'; userId: string | null }
  | { status: 'missing'; userId: string; documents: ConsentDocumentId[]; isUpdate: boolean }
  | { status: 'unavailable'; userId: string }

export default function ConsentGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? null
  const [state, setState] = useState<GateState>({ status: 'checking', userId })
  const evaluationToken = useRef(0)

  const evaluate = useCallback(async () => {
    const token = ++evaluationToken.current
    const commit = (next: GateState) => {
      // Una lectura de la cuenta anterior nunca puede pisar una evaluación más
      // nueva. El guard de render por userId solo no alcanza: sin este token,
      // una promesa vieja que termina última puede dejar loading permanente.
      if (token === evaluationToken.current) setState(next)
    }

    if (!isConsentEnforcementEnabled() || !userId) {
      commit({ status: 'open', userId })
      return
    }

    commit({ status: 'checking', userId })
    const local = await getMissingConsents(userId)
    if (local.length === 0) {
      commit({ status: 'open', userId })
      return
    }

    // El espejo no es autoridad: puede faltar en un dispositivo nuevo.
    const hydrated = await hydrateConsents(userId)
    if (!hydrated.ok) {
      // No sabemos si aceptó. Pedirlo de nuevo registraría un consentimiento
      // que quizá ya existía, así que se cierra con reintento.
      commit({ status: 'unavailable', userId })
      return
    }

    const after = await getMissingConsents(userId)
    if (after.length === 0) {
      commit({ status: 'open', userId })
      return
    }

    // Es re-aceptación si de alguno de los documentos faltantes ya se aceptó
    // una versión anterior: el texto cambió, no es la primera vez.
    const isUpdate = await hasAnyPreviousAcceptance(userId, after)
    commit({ status: 'missing', userId, documents: after, isUpdate })
  }, [userId])

  useEffect(() => {
    void evaluate()
    return () => { evaluationToken.current += 1 }
  }, [evaluate])

  // La bandera apagada conserva el render anterior sin un flash de loading.
  // Los hooks ya se declararon arriba, así que no se rompe Rules of Hooks.
  if (!isConsentEnforcementEnabled()) return <>{children}</>

  // El estado de otra cuenta no decide por esta. Mientras el efecto no haya
  // corrido para el `userId` actual, no se abre nada.
  if (state.userId !== userId) return <ConsentLoading />

  if (state.status === 'open') return <>{children}</>
  if (state.status === 'checking') return <ConsentLoading />
  if (state.status === 'unavailable') return <ConsentUnavailable onRetry={() => void evaluate()} />
  return (
    <ConsentScreen
      documents={state.documents}
      isUpdate={state.isUpdate}
      onAccepted={() => void evaluate()}
    />
  )
}

function ConsentLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="rounded-card border border-surface-border bg-surface-card px-8 py-10 text-center shadow-card">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
        <p className="mt-4 text-sm font-medium text-ink">Verificando tus consentimientos</p>
      </div>
    </div>
  )
}

function ConsentUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="max-w-md rounded-card border border-surface-border bg-surface-card px-8 py-10 text-center shadow-card">
        <p className="text-sm font-medium text-ink">No pudimos verificar tus consentimientos</p>
        <p className="mt-2 text-xs text-ink-muted">
          Necesitamos conexión para confirmar qué aceptaste. No te pedimos aceptar de nuevo
          para no registrar dos veces lo mismo.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
        >
          Reintentar
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Implementar la pantalla de aceptación**

Crear `src/components/legal/ConsentScreen.tsx`:

```tsx
import { useState } from 'react'

import { useAuthStore } from '../../store/useAuthStore'
import { acceptConsent } from '../../services/legal/consentService'
import { getDocument, type ConsentDocumentId } from '../../services/legal/consentDocuments'

const LABELS: Record<ConsentDocumentId, string> = {
  terms: 'Términos y Condiciones',
  privacy: 'Política de Privacidad',
  health: 'Descargo de salud',
  whoop_biometric: 'Descargo de datos biométricos',
}

interface ConsentScreenProps {
  documents: ConsentDocumentId[]
  onAccepted: () => void
  /** Cambia el encabezado cuando es re-aceptación por versión nueva. */
  isUpdate?: boolean
}

export default function ConsentScreen({ documents, onAccepted, isUpdate = false }: ConsentScreenProps) {
  const user = useAuthStore((s) => s.user)
  const [checked, setChecked] = useState<Set<ConsentDocumentId>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const allChecked = documents.every((id) => checked.has(id))

  const toggle = (id: ConsentDocumentId) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (!user || !allChecked) return
    setBusy(true)
    setError(undefined)

    // Uno por documento: el éxito parcial no es un caso especial porque el
    // gate recalcula desde lo confirmado.
    const results = await Promise.all(documents.map((id) => acceptConsent(user.id, id)))
    setBusy(false)

    if (results.some((result) => !result.ok)) {
      setError('No pudimos registrar todo. Revisá tu conexión y probá de nuevo.')
    }
    onAccepted()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6 py-10">
      <div className="w-full max-w-lg rounded-card border border-surface-border bg-surface-card p-8 shadow-card">
        <h1 className="text-lg font-semibold text-ink">
          {isUpdate ? 'Actualizamos nuestros documentos' : 'Antes de empezar'}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {isUpdate
            ? 'Cambió el texto de lo que sigue. Necesitamos que lo revises de nuevo.'
            : 'Necesitamos tu aceptación para poder darte el servicio.'}
        </p>

        <ul className="mt-6 space-y-3">
          {documents.map((id) => (
            <li key={id}>
              <label className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
                <input
                  type="checkbox"
                  checked={checked.has(id)}
                  onChange={() => toggle(id)}
                  className="mt-0.5 h-4 w-4 rounded border-surface-border bg-surface"
                />
                <span className="text-xs leading-relaxed text-ink-muted">
                  Acepto{' '}
                  <a href={getDocument(id).route} target="_blank" rel="noreferrer" className="underline">
                    {LABELS[id]}
                  </a>{' '}
                  <span className="text-ink-subtle">(versión {getDocument(id).currentVersion})</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {error && <p className="mt-4 text-xs text-danger">{error}</p>}

        <button
          type="button"
          disabled={!allChecked || busy}
          onClick={() => void submit()}
          className="mt-6 w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Registrando…' : 'Acepto y continuar'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Montar el gate**

En `src/App.tsx:353`, `AuthGate` abre y cierra en la línea 377. `ConsentGate` se anida inmediatamente adentro, envolviendo `CoachScopeGuard` y `OnboardingGuard`:

```tsx
            <AuthGate>
              <ConsentGate>
                <CoachScopeGuard />
                <OnboardingGuard>
                  {/* …rutas privadas sin cambios… */}
                </OnboardingGuard>
              </ConsentGate>
            </AuthGate>
```

Va **dentro** de `AuthGate` porque sin usuario no hay a quién pedirle consentimiento, y **fuera** de `OnboardingGuard` porque aceptar los términos precede a completar el perfil. Las rutas legales de las líneas 347-350 están fuera de este bloque y no se tocan: tienen que ser legibles para poder decidir.

- [ ] **Step 5b: Mantener salida y derechos de datos**

Renderizar `ConsentAccountActions` tanto en la pantalla de aceptación como en
los estados de carga e indisponibilidad. Debe llamar los mismos servicios de
exportación y wipe que Settings, usar confirmación explícita para borrar y
permitir `signOut`. No se exceptúa `SettingsPage` completa. Tests: las tres
acciones funcionan sin aceptar y el gate las muestra en los tres estados.

- [ ] **Step 6: Correr y verificar que pasa**

Run: `npx vitest run src/components/legal/__tests__/ConsentGate.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 7: Verificar que las rutas legales siguen públicas**

Run: `npx vitest run src/pages/PublicLegalLinks.test.tsx src/pages/TermsPage.test.tsx src/pages/PrivacyPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit (ofrecer al owner)**

```bash
git add src/components/legal/ConsentGate.tsx src/components/legal/ConsentScreen.tsx src/components/legal/__tests__/ConsentGate.test.tsx src/App.tsx
git commit -m "feat(consent): gate the authenticated app on current consent"
```

---

## Task 6: Enforcement de Whoop en el servidor

**Files:**
- Create: `netlify/functions/_shared/consentFlag.ts`
- Create: `netlify/functions/_shared/consentEnforcement.ts`
- Modify: `netlify/functions/whoop-oauth-start.ts`, `whoop-oauth-callback.ts` (tipo `CallbackFailureReason` línea 10), `whoop-sync.ts` (solo `POST`), `netlify/functions/_shared/whoopCron.ts:55` (**no** `whoop-cron.ts`)
- Modify: `src/components/settings/WhoopConnection.tsx` (reemplazar el `useState` de la línea 243)
- Modify: `src/components/legal/ConsentScreen.tsx` (variante `inline`)
- Modify: `src/hooks/useWhoopSync.ts`
- Modify: `src/services/readiness/whoopApi.ts` (`WhoopSyncResponse.code` y `ok: false` en 403)
- Modify: `src/services/legal/consentService.ts` (verificación remota autoritativa tras rechazo de servidor)
- Test: `netlify/functions/_shared/__tests__/consentEnforcement.test.ts`
- Test: handlers de OAuth start/callback/sync/cron y tests existentes de `WhoopConnection`/`useWhoopSync`
- Test: `src/services/readiness/__tests__/whoopApi.test.ts` y reconciliación OAuth en `WhoopConnection.test.tsx`

**Interfaces:**
- Consumes: `getCurrentVersion` de `src/services/legal/consentDocuments.ts` (Task 1).
- Produces: `hasCurrentWhoopConsent(userId: string): Promise<boolean>`, `isConsentEnforcementEnabled(): boolean` (versión servidor).

**Por qué esta tarea existe.** El hook `useWhoopSync` es UX, no control de acceso: `whoop-sync.ts` y `whoop-oauth-start.ts` son endpoints POST que cualquier cliente autenticado invoca directo. Sin comprobación en el servidor, apagar el hook no impide nada.

- [ ] **Step 1: Escribir el test (rojo)**

Crear `netlify/functions/_shared/__tests__/consentEnforcement.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { hasCurrentWhoopConsent } from '../consentEnforcement'
import { getCurrentVersion } from '../../../../src/services/legal/consentDocuments'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('hasCurrentWhoopConsent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    process.env['SUPABASE_URL'] = 'https://example.supabase.co'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-key'
  })

  it('acepta cuando existe la versión vigente', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ version: getCurrentVersion('whoop_biometric') }],
    })
    expect(await hasCurrentWhoopConsent('user-1')).toBe(true)
  })

  it('rechaza cuando solo hay una versión anterior', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ version: '2026-01-01' }] })
    expect(await hasCurrentWhoopConsent('user-1')).toBe(false)
  })

  it('rechaza cuando no hay ninguna', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] })
    expect(await hasCurrentWhoopConsent('user-1')).toBe(false)
  })

  it('rechaza si la consulta falla: fail-closed', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    expect(await hasCurrentWhoopConsent('user-1')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run netlify/functions/_shared/__tests__/consentEnforcement.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar la bandera y la comprobación del servidor**

Crear `netlify/functions/_shared/consentFlag.ts`:

```ts
/**
 * Adaptador de servidor. Misma firma que `src/services/legal/consentFlag.ts`,
 * distinta fuente: `VITE_*` no llega a las funciones de Netlify.
 */
export function isConsentEnforcementEnabled(): boolean {
  return process.env['CONSENT_GATE_ENABLED'] === 'true'
}
```

Crear `netlify/functions/_shared/consentEnforcement.ts`:

```ts
import { getCurrentVersion } from '../../../src/services/legal/consentDocuments'

/**
 * Fail-closed: si no podemos comprobar el consentimiento, no procesamos datos
 * biométricos. Es preferible pausar de más que traer datos sin permiso vigente.
 */
export async function hasCurrentWhoopConsent(userId: string): Promise<boolean> {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return false

  const version = getCurrentVersion('whoop_biometric')
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/user_consents`
    + `?user_id=eq.${encodeURIComponent(userId)}`
    + `&document=eq.whoop_biometric&select=version`

  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!response.ok) return false
    const rows = (await response.json()) as Array<{ version: string }>
    return rows.some((row) => row.version === version)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run netlify/functions/_shared/__tests__/consentEnforcement.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Cablear los cuatro accesos, cada uno con su respuesta**

Cada punto comprueba **solo si la bandera del servidor está encendida**; con la
bandera apagada se comporta como hoy.

**`whoop-oauth-start.ts`**, después de `resolveAuthContext` (línea ~13):

```ts
  if (isConsentEnforcementEnabled() && !(await hasCurrentWhoopConsent(auth.userId))) {
    return json(403, { ok: false, error: 'Consentimiento biométrico requerido.', code: 'consent_required' })
  }
```

**`whoop-sync.ts`** — el handler acepta `POST` y `DELETE` (línea 50). El control
va **solo en `POST`**. `DELETE` es desconectar y borrar datos: bloquear eso por
falta de consentimiento sería perverso, porque le impediría a alguien retirar
sus datos justamente cuando ya no quiere darlos.

```ts
  if (
    event.httpMethod === 'POST'
    && isConsentEnforcementEnabled()
    && !(await hasCurrentWhoopConsent(auth.userId))
  ) {
    return json(403, { ok: false, error: 'Consentimiento biométrico requerido.', code: 'consent_required' })
  }
```

**`whoop-oauth-callback.ts`** — no devuelve 403: es una vuelta del navegador
desde Whoop y un JSON crudo sería lo que ve el usuario. Usa los identificadores
reales del archivo: `consumed.userId` (línea 55) y el helper `errorLocation`
(línea 22). Primero agregar el motivo al tipo `CallbackFailureReason` (línea 10):

```ts
type CallbackFailureReason =
  // …motivos existentes…
  | 'consent_required'
```

Y después de consumir el state, antes de persistir el token:

```ts
  if (isConsentEnforcementEnabled() && !(await hasCurrentWhoopConsent(consumed.userId))) {
    return redirect(errorLocation(nativeReturn, 'consent_required'))
  }
```

`errorLocation` ya resuelve `rallyiq://settings` o `/settings` según
`nativeReturn`, así que el deep link nativo sigue funcionando sin código extra.

**El cron** — el loop **no** está en `whoop-cron.ts` sino en
`netlify/functions/_shared/whoopCron.ts:55`:

```ts
  for (const userId of userIds) {
    await runWhoopSync(baseDeps(db), { userId, trigger: 'cron' }).catch(() => undefined)
  }
```

Se omite la cuenta y se sigue: no hay a quién responderle, y abortar la corrida
entera por una cuenta sin consentimiento sería peor.

```ts
  for (const userId of userIds) {
    if (isConsentEnforcementEnabled() && !(await hasCurrentWhoopConsent(userId))) continue
    await runWhoopSync(baseDeps(db), { userId, trigger: 'cron' }).catch(() => undefined)
  }
```

- [ ] **Step 6: Variante inline de `ConsentScreen`**

`ConsentScreen` hoy es una pantalla completa (`min-h-screen`, centrada). Dentro
de Settings quedaría incrustada y rompería el layout. Agregarle una variante:

```tsx
interface ConsentScreenProps {
  documents: ConsentDocumentId[]
  onAccepted: () => void
  isUpdate?: boolean
  /** `inline` la embebe en una tarjeta existente en vez de ocupar la pantalla. */
  variant?: 'page' | 'inline'
}
```

y en el render, reemplazar el contenedor externo por:

```tsx
  const shell = variant === 'inline'
    ? 'rounded-xl border border-surface-border bg-surface-raised p-4'
    : 'flex min-h-screen items-center justify-center bg-surface px-6 py-10'
  const card = variant === 'inline'
    ? ''
    : 'w-full max-w-lg rounded-card border border-surface-border bg-surface-card p-8 shadow-card'
```

- [ ] **Step 7: `WhoopConnection` con bandera y estado real**

En `src/components/settings/WhoopConnection.tsx`, conservar el checkbox
`biometricConsent` **solo como fallback legacy cuando la bandera está apagada**.
Con la feature apagada el comportamiento debe ser exactamente el actual: no
alcanza con dejar el botón siempre habilitado. Con la bandera encendida se usa
el estado persistido y se oculta el checkbox legacy.

**Dos trampas que hay que evitar.** El componente expone `status?.connected`
(línea 44 y 183), **no** `connection?.status`. Y el estado inicial no puede ser
`true`: con la bandera apagada dejaría el botón de conectar bloqueado para
siempre, rompiendo Whoop en producción.

```tsx
  type ConsentCheckState = 'checking' | 'current' | 'missing' | 'unavailable'
  const consentEnabled = isConsentEnforcementEnabled()
  const [consentState, setConsentState] = useState<ConsentCheckState>(
    consentEnabled ? 'checking' : 'current',
  )

  const refreshConsent = useCallback(async () => {
    if (!consentEnabled) {
      setConsentState('current')
      return
    }
    if (!userId) {
      setConsentState('checking')
      return
    }
    setConsentState('checking')
    // El espejo puede estar vacío en este dispositivo: hidratar antes de pedir.
    const localMissing = await getMissingConsents(userId, ['whoop_biometric'])
    if (localMissing.length === 0) {
      setConsentState('current')
      return
    }
    const hydrated = await hydrateConsents(userId)
    if (!hydrated.ok) {
      // No ofrecer aceptar si no sabemos si ya existe remoto: mismo contrato
      // que ConsentGate, para no inducir una aceptación duplicada.
      setConsentState('unavailable')
      return
    }
    const missing = await getMissingConsents(userId, ['whoop_biometric'])
    setConsentState(missing.length > 0 ? 'missing' : 'current')
  }, [consentEnabled, userId])

  useEffect(() => { void refreshConsent() }, [refreshConsent, status?.connected])
```

En el render, antes del botón de conectar:

```tsx
      {consentEnabled && consentState === 'missing' && (
        <ConsentScreen
          variant="inline"
          documents={['whoop_biometric']}
          isUpdate={Boolean(status?.connected)}
          onAccepted={() => void refreshConsent()}
        />
      )}
      {consentEnabled && consentState === 'missing' && Boolean(status?.connected) && (
        <p className="mt-3 text-xs text-ink-muted">
          Pausamos la sincronización hasta que aceptes el descargo actualizado.
        </p>
      )}
```

Cuando `consentState === 'unavailable'`, mostrar explicación y botón
`Reintentar` que llama `refreshConsent`; no renderizar `ConsentScreen`.
`checking`, `missing` y `unavailable` deshabilitan conectar, reconectar y sync.
Con la bandera apagada se renderiza el checkbox legacy y el botón conserva
`disabled={actionBusy || !biometricConsent}`. Con la bandera encendida usa
`disabled={actionBusy || consentState !== 'current'}`.

- [ ] **Step 8: `useWhoopSync` no dispara sin consentimiento**

Sin esto, el Dashboard sigue llamando al endpoint y recibe un 403 genérico que
el usuario ve como "falló la sincronización". En `src/hooks/useWhoopSync.ts`,
leer `userId` desde `useAuthStore`. Antes de disparar la sincronización,
hidratar si el espejo local dice que falta; si la hidratación falla, no asumir
que corresponde pedir de nuevo:

```ts
    if (isConsentEnforcementEnabled() && userId) {
      let missing = await getMissingConsents(userId, ['whoop_biometric'])
      if (missing.length > 0) {
        const hydrated = await hydrateConsents(userId)
        if (!hydrated.ok) {
          setMessage('No pudimos verificar tu consentimiento biométrico. Revisá tu conexión.')
          return null
        }
        missing = await getMissingConsents(userId, ['whoop_biometric'])
      }
      if (missing.length > 0) {
        setMessage('Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.')
        return null
      }
    }
```

Extender `WhoopSyncResponse` en `whoopApi.ts` con
`code?: 'consent_required'` y hacer que el 403 del servidor tenga `ok: false`.
Al recibir ese código, traducirlo al mismo mensaje en vez del error genérico:
el servidor es la autoridad y el cliente puede tener el espejo desactualizado.

`startWhoopConnect` también debe leer el body no-2xx y preservar
`consent_required` en un error tipado. Ese 403 no demuestra por sí solo que
falte consentimiento, porque el servidor falla cerrado ante errores de
Supabase: `WhoopConnection` hace una lectura remota autoritativa. Solo si esa
lectura confirma que falta la versión muestra re-aceptación; si falla o confirma
la fila vigente, muestra `unavailable` y reintento. El espejo local no decide
este caso de discrepancia.

- [ ] **Step 8b: Tests del cableado, no solo del helper**

Agregar cobertura explícita para los cuatro accesos:

- OAuth start: 403 `consent_required` con bandera encendida y comportamiento
  anterior con bandera apagada.
- Callback: redirige mediante `errorLocation`, no intercambia/persiste token
  cuando falta consentimiento.
- Sync: `POST` queda bloqueado; `DELETE` continúa permitido.
- Cron: omite una cuenta sin consentimiento y continúa sincronizando la
  siguiente.

Extender además `WhoopConnection.test.tsx` para congelar fallback legacy con la
bandera apagada y estados `checking/missing/unavailable/current`; extender
`useWhoopSync.test.ts` para hidratación remota y traducción del 403.

- [ ] **Step 9: Verificar**

Run: `npx vitest run netlify/functions/ src/components/settings/ src/hooks/ src/components/legal/ && npx tsc -b`
Expected: verde. Correr además la suite con la bandera **apagada** y confirmar
que `WhoopConnection` conserva el checkbox legacy y su disabled actual: es la
regresión más fácil de introducir en esta tarea.

- [ ] **Step 10: Commit (ofrecer al owner)**

```bash
git add netlify/functions src/components/settings/WhoopConnection.tsx \
  src/components/settings/__tests__/WhoopConnection.test.tsx \
  src/components/legal/ConsentScreen.tsx src/hooks/useWhoopSync.ts \
  src/hooks/__tests__/useWhoopSync.test.ts src/services/readiness/whoopApi.ts
git commit -m "feat(consent): enforce biometric consent on every Whoop access"
```

---

## Task 7: Rollout y verificación integral

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md`
- Modify: `src/pages/SettingsPage.tsx:415` (solo si se decide ajustar el copy)

- [ ] **Step 1: Verificación completa**

```bash
npx tsc -b && npm run lint && npm test && npm run build && git diff --check
```

Expected: tsc y `git diff --check` sin salida; lint limpio; suite verde; build OK. Anotar el conteo de tests.

- [ ] **Step 2: Verificar que con las banderas apagadas nada cambió**

Con `VITE_CONSENT_GATE` y `CONSENT_GATE_ENABLED` sin definir, correr la suite completa: el gate no debe aparecer y los cuatro accesos de Whoop no deben exigir nada. Es el estado de despliegue por defecto.

- [ ] **Step 3: Documentar el estado**

En `CLAUDE.md` (bloques recientes) y `PROJECT_REVIEW_AND_ROADMAP.md` (sección nueva), registrar: qué hace, que trae migración `017` **escrita y no aplicada** y Dexie **v19**, el conteo de tests, y las tres preguntas abiertas del §8 del spec con su default.

- [ ] **Step 4: Dejar escrito el procedimiento de encendido**

En el roadmap, como checklist explícita:

1. Aplicar `017` en Supabase (manual, lo hace el owner).
2. Desplegar con ambas banderas **apagadas** y verificar que nada cambió.
3. Confirmar textos legales aprobados por el abogado. Si cambiaron, publicar versión nueva con id nuevo antes de encender.
4. Resolver la contradicción con `SettingsPage.tsx:415`: hoy promete borrar "TODOS tus datos locales y remotos", y conservar `user_consents` lo incumple. Ajustar el copy o resolver §8.1 en favor del borrado. **No encender con la contradicción viva.**
5. Encender `VITE_CONSENT_GATE` y `CONSENT_GATE_ENABLED` **juntas**. Encenderlas desacopladas es un estado inválido: solo servidor pausa Whoop sin salida, solo cliente deja el enforcement real descubierto.
6. Smoke: aceptar los tres documentos, verificar la fila en `user_consents`, recargar sin red y confirmar que el gate abre desde el espejo.

- [ ] **Step 5: Commit (ofrecer al owner)**

```bash
git add CLAUDE.md PROJECT_REVIEW_AND_ROADMAP.md docs/superpowers/plans/2026-08-03-in-app-consent.md docs/superpowers/specs/2026-08-02-in-app-consent-design.md
git commit -m "docs(consent): record in-app consent delivery and rollout procedure"
```

---

## Notas de ejecución

**Orden.** Estrictamente secuencial: cada tarea consume tipos de la anterior. La 1 es la más larga porque incluye la transcripción de los cuatro documentos; el test de paridad del Step 1-2 es lo que la hace segura.

**El punto donde es fácil equivocarse.** Task 1 Step 2: los snapshots de paridad se generan sobre el código **actual**, antes de migrar. Si se generan después, congelan el resultado de la migración y dejan de probar nada — el mismo error que ya cometimos una vez con el basal de fuerza.

**Lo que este plan no hace.** No aplica `017`, no enciende banderas, no redacta ni corrige texto legal, y no resuelve las tres preguntas del §8. Todo eso es del owner y del abogado.
