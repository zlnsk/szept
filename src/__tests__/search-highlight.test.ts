import { describe, it, expect } from 'vitest'
import { applySearchHighlight } from '@/components/chat/message-content'

describe('applySearchHighlight', () => {
  it('returns unchanged HTML when term is empty', () => {
    const html = '<b>hello world</b>'
    expect(applySearchHighlight(html, '')).toBe(html)
  })

  it('returns unchanged HTML when term is too short (1 char)', () => {
    const html = '<b>hello world</b>'
    expect(applySearchHighlight(html, 'h')).toBe(html)
  })

  it('highlights text in simple strings', () => {
    const result = applySearchHighlight('hello world', 'world')
    expect(result).toContain('<mark')
    expect(result).toContain('world</mark>')
    // Non-matching text should remain
    expect(result).toContain('hello ')
  })

  it('does NOT modify text inside HTML tag attributes', () => {
    const html = '<a href="https://test.com">test link</a>'
    const result = applySearchHighlight(html, 'test')
    // The href attribute must remain untouched
    expect(result).toContain('href="https://test.com"')
    // The text content should be highlighted
    expect(result).toContain('<mark')
    expect(result).toContain('test</mark>')
  })

  it('does not corrupt href containing the search term', () => {
    const html = '<a href="https://example.com/search">search here</a>'
    const result = applySearchHighlight(html, 'search')
    // href must not contain a <mark> tag
    expect(result).toContain('href="https://example.com/search"')
    expect(result).toContain('<mark')
  })

  it('handles multiple matches', () => {
    const result = applySearchHighlight('foo bar foo baz foo', 'foo')
    const markCount = (result.match(/<mark/g) || []).length
    expect(markCount).toBe(3)
  })

  it('performs case-insensitive matching', () => {
    const result = applySearchHighlight('Hello HELLO hello', 'hello')
    const markCount = (result.match(/<mark/g) || []).length
    expect(markCount).toBe(3)
    // Each variant should be preserved in its original case
    expect(result).toContain('Hello</mark>')
    expect(result).toContain('HELLO</mark>')
    expect(result).toContain('hello</mark>')
  })

  it('escapes special regex characters in search term', () => {
    const result = applySearchHighlight('price is $100 (USD)', '$100')
    expect(result).toContain('<mark')
    expect(result).toContain('$100</mark>')
  })

  it('escapes parentheses in search term', () => {
    const result = applySearchHighlight('call fn() now', 'fn()')
    expect(result).toContain('<mark')
    expect(result).toContain('fn()</mark>')
  })

  it('escapes brackets in search term', () => {
    const result = applySearchHighlight('array[0] = 1', '[0]')
    expect(result).toContain('<mark')
    expect(result).toContain('[0]</mark>')
  })

  it('returns HTML unchanged when term has no matches', () => {
    const html = '<b>hello world</b>'
    const result = applySearchHighlight(html, 'xyz')
    expect(result).toBe('<b>hello world</b>')
  })

  it('highlights across multiple text nodes in complex HTML', () => {
    const html = '<p>first match</p><p>second match</p>'
    const result = applySearchHighlight(html, 'match')
    const markCount = (result.match(/<mark/g) || []).length
    expect(markCount).toBe(2)
  })
})
