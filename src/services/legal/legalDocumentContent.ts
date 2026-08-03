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
