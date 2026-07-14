const FORM_CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * iOS shrinks the webview when the keyboard opens (KeyboardResize.Native), but it
 * does not reliably scroll the focused control back into the smaller viewport when
 * that control lives inside an app scroll container. Centering it keeps the field
 * visible above the keyboard without moving any layout.
 */
export function scrollFocusedControlIntoView(doc: Document = document): boolean {
  const element = doc.activeElement as HTMLElement | null
  if (!element) return false

  const editable = element.isContentEditable === true
  if (!editable && !FORM_CONTROLS.has(element.tagName)) return false
  if (typeof element.scrollIntoView !== 'function') return false

  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}
