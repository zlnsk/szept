import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  renderRichContent,
  applySearchHighlight,
  isEmojiOnly,
  extractFirstUrl,
  parseDisplayName,
} from '@/components/chat/message-content'

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    )
  })

  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
  })

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})

describe('renderRichContent', () => {
  it('sanitizes HTML formatted content', () => {
    const result = renderRichContent('', '<b>bold</b><script>evil</script>')
    expect(result).toContain('<b>bold</b>')
    expect(result).not.toContain('<script>')
  })

  it('converts markdown bold to HTML', () => {
    const result = renderRichContent('**bold text**', null)
    expect(result).toContain('<strong>bold text</strong>')
  })

  it('converts markdown italic to HTML', () => {
    const result = renderRichContent('*italic text*', null)
    expect(result).toContain('<em>italic text</em>')
  })

  it('converts inline code to HTML', () => {
    const result = renderRichContent('use `code` here', null)
    expect(result).toContain('<code>code</code>')
  })

  it('converts strikethrough to HTML', () => {
    const result = renderRichContent('~~deleted~~', null)
    expect(result).toContain('<del>deleted</del>')
  })

  it('auto-links URLs', () => {
    const result = renderRichContent('visit https://example.com today', null)
    expect(result).toContain('href="https://example.com"')
    expect(result).toContain('target="_blank"')
  })

  it('strips dangerous attributes from formatted content', () => {
    const result = renderRichContent('', '<a href="x" onclick="alert(1)">link</a>')
    expect(result).not.toContain('onclick')
  })

  it('strips style attributes', () => {
    const result = renderRichContent('', '<span style="color:red">text</span>')
    expect(result).not.toContain('style')
  })
})

describe('applySearchHighlight', () => {
  it('highlights matching text', () => {
    const result = applySearchHighlight('hello world', 'world')
    expect(result).toContain('<mark')
    expect(result).toContain('world')
  })

  it('ignores short search terms', () => {
    const result = applySearchHighlight('hello world', 'h')
    expect(result).not.toContain('<mark')
  })

  it('does not highlight inside HTML tags', () => {
    const result = applySearchHighlight('<a href="test">test link</a>', 'test')
    // Should highlight "test" in text but not in href attribute
    expect(result).toContain('href="test"')
  })

  it('returns original HTML when term is empty', () => {
    const html = '<b>text</b>'
    expect(applySearchHighlight(html, '')).toBe(html)
  })
})

describe('isEmojiOnly', () => {
  it('detects single emoji', () => {
    expect(isEmojiOnly('👍')).toBe(true)
  })

  it('detects multiple emojis', () => {
    expect(isEmojiOnly('😂🔥')).toBe(true)
  })

  it('rejects text with emoji', () => {
    expect(isEmojiOnly('hello 👍')).toBe(false)
  })

  it('rejects plain text', () => {
    expect(isEmojiOnly('hello world')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isEmojiOnly('')).toBe(false)
  })

  it('rejects very long emoji strings', () => {
    expect(isEmojiOnly('😂'.repeat(20))).toBe(false)
  })
})

describe('extractFirstUrl', () => {
  it('extracts HTTP URL', () => {
    expect(extractFirstUrl('visit https://example.com today')).toBe('https://example.com')
  })

  it('extracts first URL from multiple', () => {
    expect(extractFirstUrl('see https://a.com and https://b.com')).toBe('https://a.com')
  })

  it('returns null when no URL', () => {
    expect(extractFirstUrl('no urls here')).toBeNull()
  })

  it('handles URL with path', () => {
    expect(extractFirstUrl('check https://example.com/path/to/page')).toBe(
      'https://example.com/path/to/page'
    )
  })
})

describe('parseDisplayName', () => {
  it('strips SDK disambiguation suffix', () => {
    const result = parseDisplayName('Alice (@alice:matrix.org)', '@alice:matrix.org')
    expect(result.displayName).toBe('Alice')
    expect(result.matrixId).toBe('@alice:matrix.org')
  })

  it('shortens raw Matrix ID to localpart', () => {
    const result = parseDisplayName('@alice:matrix.org', '@alice:matrix.org')
    expect(result.displayName).toBe('alice')
    expect(result.matrixId).toBe('@alice:matrix.org')
  })

  it('returns clean name without Matrix ID for bridge users', () => {
    const result = parseDisplayName('Alice', '@signal_123:matrix.org')
    expect(result.displayName).toBe('Alice')
    expect(result.matrixId).toBeNull()
  })

  it('handles names starting with @', () => {
    const result = parseDisplayName('@bob:server.com', '@bob:server.com')
    expect(result.displayName).toBe('bob')
    expect(result.matrixId).toBe('@bob:server.com')
  })
})
