import { describe, expect, it, vi } from 'vitest'
import { scrollFocusedControlIntoView } from '../keyboardFocus'

function docWithFocus(active: { tagName?: string; isContentEditable?: boolean } | null) {
  const scrollIntoView = vi.fn()
  const activeElement = active ? { scrollIntoView, ...active } : null
  return { doc: { activeElement } as unknown as Document, scrollIntoView }
}

describe('scrollFocusedControlIntoView', () => {
  it('centers the focused text field so the keyboard cannot cover it', () => {
    const { doc, scrollIntoView } = docWithFocus({ tagName: 'INPUT' })

    expect(scrollFocusedControlIntoView(doc)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('centers a focused textarea', () => {
    const { doc, scrollIntoView } = docWithFocus({ tagName: 'TEXTAREA' })

    expect(scrollFocusedControlIntoView(doc)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('centers a focused contenteditable', () => {
    const { doc, scrollIntoView } = docWithFocus({ tagName: 'DIV', isContentEditable: true })

    expect(scrollFocusedControlIntoView(doc)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('leaves the page alone when nothing editable holds focus', () => {
    const { doc, scrollIntoView } = docWithFocus({ tagName: 'DIV' })

    expect(scrollFocusedControlIntoView(doc)).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing when the document has no active element', () => {
    const { doc, scrollIntoView } = docWithFocus(null)

    expect(scrollFocusedControlIntoView(doc)).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
