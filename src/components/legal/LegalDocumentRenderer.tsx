import type { LegalBlock, LegalSpan } from '../../services/legal/legalDocumentContent'
import { Link } from 'react-router-dom'
import {
  getDocument,
  getPublication,
  type ConsentDocumentId,
} from '../../services/legal/consentDocuments'
import LegalPageLayout from './LegalPageLayout'

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
      // La fecha sale del manifiesto, nunca de un literal en la página.
      updatedAt={document.currentVersion}
    >
      {publication.content.blocks.map(renderBlock)}
    </LegalPageLayout>
  )
}
