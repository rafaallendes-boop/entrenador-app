export function normalizeCoachMarkdown(text: string): string {
  return text
    // In lists, "* Label:*" is a bullet marker plus a dangling emphasis close.
    .replace(/^(\s*[*-]\s+)([^*\n]+):\s*\*$/gm, '$1$2:')
    // Gemini sometimes emits emphasis as "*Label:*"; move the colon outside
    // so the inline parser does not leave a raw trailing asterisk.
    .replace(/\*([^*\n]+):\*/g, '*$1*:')
    .replace(/^([^*\n]+):\s*\*$/gm, '$1:')
}
