import type { LegalBlock, LegalSpan } from '../../services/legal/legalDocumentContent'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  getDocument,
  getPublication,
  type ConsentDocumentId,
} from '../../services/legal/consentDocuments'
import LegalPageLayout, { type LegalSection } from './LegalPageLayout'

/** Ancla por posición: el texto del encabezado es contenido legal versionado y no debe acoplarse a una URL. */
const sectionAnchor = (index: number) => `seccion-${index + 1}`

function renderSpan(span: LegalSpan, index: number) {
  if ('href' in span && span.href.startsWith('/')) {
    return <Link key={index} to={span.href}>{span.text}</Link>
  }
  if ('href' in span) return <a key={index} href={span.href}>{span.text}</a>
  if ('strong' in span) return <strong key={index}>{span.text}</strong>
  return <span key={index}>{span.text}</span>
}

function renderBlock(block: LegalBlock, index: number, anchorByBlock: Map<number, string>) {
  if (block.kind === 'heading') return <h2 key={index} id={anchorByBlock.get(index)}>{block.text}</h2>
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

  // Memoizado a propósito: `sections` es dependencia del efecto que arma el
  // IntersectionObserver del índice, y ese efecto además dispara el `setState`
  // que provoca el re-render. Con una identidad nueva por render, el observer se
  // desconectaría y volvería a crearse en cada scroll marcado.
  const { sections, anchorByBlock } = useMemo(() => {
    const collected: LegalSection[] = []
    const anchors = new Map<number, string>()
    publication.content.blocks.forEach((block, blockIndex) => {
      if (block.kind !== 'heading') return
      const anchor = sectionAnchor(collected.length)
      anchors.set(blockIndex, anchor)
      collected.push({ id: anchor, text: block.text })
    })
    return { sections: collected, anchorByBlock: anchors }
  }, [publication])

  return (
    <LegalPageLayout
      eyebrow={publication.content.eyebrow}
      title={publication.content.title}
      metaRoute={document.route}
      // La fecha sale del manifiesto, nunca de un literal en la página.
      updatedAt={document.currentVersion}
      sections={sections}
    >
      {publication.content.blocks.map((block, index) => renderBlock(block, index, anchorByBlock))}
    </LegalPageLayout>
  )
}
