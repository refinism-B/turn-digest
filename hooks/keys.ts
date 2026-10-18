export const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** FNV-1a 32-bit of the normalized text, as 8 hex digits: a text row's id. */
export const textKey = (text: string): string => {
  let hash = 0x811c9dc5
  for (const char of norm(text)) {
    const code = char.codePointAt(0) ?? 0
    hash ^= code
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

export const isQuestion = (text: string): boolean => /[?？]/.test(text)
