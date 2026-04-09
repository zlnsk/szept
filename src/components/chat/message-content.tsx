'use client'

import DOMPurify from 'dompurify'

// Shared DOMPurify config — restrict to safe subset of HTML
const PURIFY_CONFIG_FORMATTED = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'del', 's', 'strike', 'code', 'pre', 'br', 'p', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'sup', 'sub', 'hr', 'mx-reply'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'data-mx-color', 'data-mx-bg-color', 'class'],
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'svg', 'math', 'foreignobject', 'annotation-xml'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'style', 'xlink:href'],
  ALLOW_DATA_ATTR: false,
}

const PURIFY_CONFIG_PLAIN = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'del', 's', 'code', 'pre', 'br', 'a', 'blockquote', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math', 'foreignobject', 'annotation-xml'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'style'],
  ALLOW_DATA_ATTR: false,
}

// Force rel="noopener noreferrer" on all anchor tags to prevent window.opener attacks
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noopener noreferrer')
    node.setAttribute('target', '_blank')
  }
})

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Apply basic syntax highlighting to code text using regex.
 * Expects HTML-escaped text (e.g. from escapeHtml or DOMPurify output inside code blocks).
 * Returns HTML with <span> wrappers for syntax tokens.
 */
function highlightSyntax(code: string): string {
  if (!code || code.length === 0) return code
  // Cap input length to avoid performance issues on very large blocks
  if (code.length > 100_000) return code

  // Token types and their Tailwind classes
  const TOKEN_CLASSES = {
    comment: 'text-gray-500 dark:text-gray-500 italic',
    string: 'text-green-700 dark:text-green-400',
    keyword: 'text-purple-600 dark:text-purple-400',
    number: 'text-orange-600 dark:text-orange-400',
    decorator: 'text-yellow-600 dark:text-yellow-400',
    function: 'text-blue-600 dark:text-blue-400',
    type: 'text-cyan-600 dark:text-cyan-400',
  } as const

  // Ordered list of token patterns — earlier patterns take priority
  // All patterns operate on HTML-escaped text, so < > & " are entities
  const patterns: Array<{ regex: RegExp; type: keyof typeof TOKEN_CLASSES; group?: number }> = [
    // Multi-line comments: /* ... */
    { regex: /\/\*[\s\S]*?\*\//g, type: 'comment' },
    // Single-line comments: // ...
    { regex: /\/\/[^\n]*/g, type: 'comment' },
    // Hash comments: # ...
    { regex: /(^|[\n])#[^\n]*/g, type: 'comment' },
    // Double-quoted strings (HTML-escaped quotes: &quot;)
    { regex: /&quot;(?:[^&]|&(?!quot;))*?&quot;/g, type: 'string' },
    // Double-quoted strings (literal quotes, for formatted_body path)
    { regex: /"(?:[^"\\]|\\.)*"/g, type: 'string' },
    // Single-quoted strings
    { regex: /'(?:[^'\\]|\\.)*'/g, type: 'string' },
    // Template literals
    { regex: /`(?:[^`\\]|\\.)*`/g, type: 'string' },
    // Decorators/attributes: @word
    { regex: /@\w+/g, type: 'decorator' },
    // Keywords (broad set covering JS/TS/Python/Rust/Go)
    { regex: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|from|default|new|this|typeof|instanceof|try|catch|finally|throw|async|await|yield|of|in|true|false|null|undefined|void|delete|interface|type|enum|implements|private|public|protected|static|readonly|abstract|override|declare|namespace|module|require|as|is|keyof|infer|never|unknown|any|string|number|boolean|object|symbol|bigint|def|self|elif|pass|lambda|with|assert|raise|except|print|None|True|False|fn|mut|pub|struct|impl|trait|use|mod|crate|match|loop|move|ref|where|unsafe|dyn|macro)\b/g, type: 'keyword' },
    // Numbers: hex, floats, integers
    { regex: /\b0x[0-9a-fA-F]+\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, type: 'number' },
    // Function calls: word followed by (
    { regex: /\b([a-z_]\w*)\s*(?=\()/gi, type: 'function', group: 1 },
    // Types/classes: capitalized identifiers (PascalCase)
    { regex: /\b([A-Z][a-zA-Z0-9_]*)\b/g, type: 'type' },
  ]

  // Tokenize: collect all matches with positions, then resolve overlaps
  type Token = { start: number; end: number; type: keyof typeof TOKEN_CLASSES; text: string }
  const tokens: Token[] = []

  for (const { regex, type, group } of patterns) {
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(code)) !== null) {
      const matchedText = group !== undefined ? m[group] : m[0]
      const start = group !== undefined ? m.index + m[0].indexOf(m[group]) : m.index
      const end = start + matchedText.length
      tokens.push({ start, end, type, text: matchedText })
    }
  }

  // Sort by start position; earlier patterns (added first) win ties via stable sort
  tokens.sort((a, b) => a.start - b.start)

  // Remove overlapping tokens — first match wins
  const accepted: Token[] = []
  let lastEnd = 0
  for (const tok of tokens) {
    if (tok.start >= lastEnd) {
      // Skip tokens that are just single digits or trivially short numbers inside words
      accepted.push(tok)
      lastEnd = tok.end
    }
  }

  // Build output
  if (accepted.length === 0) return code

  const parts: string[] = []
  let pos = 0
  for (const tok of accepted) {
    if (tok.start > pos) {
      parts.push(code.slice(pos, tok.start))
    }
    parts.push(`<span class="${TOKEN_CLASSES[tok.type]}">${tok.text}</span>`)
    pos = tok.end
  }
  if (pos < code.length) {
    parts.push(code.slice(pos))
  }

  return parts.join('')
}

/**
 * Process final HTML to apply syntax highlighting to <pre><code> blocks
 * and add styling classes for a polished code block appearance.
 */
function highlightCodeBlocks(html: string): string {
  // Quick check — avoid DOM parsing when there are no code blocks
  if (!html.includes('<pre>') && !html.includes('<code')) return html

  const container = document.createElement('div')
  container.innerHTML = html

  const codeBlocks = container.querySelectorAll('pre code')
  for (const block of codeBlocks) {
    const text = block.textContent || ''
    if (text.length > 0) {
      // Re-escape the text content so highlightSyntax operates on HTML-escaped input
      block.innerHTML = highlightSyntax(escapeHtml(text))
    }
  }

  // Style <pre> elements for a polished look
  const preBlocks = container.querySelectorAll('pre')
  for (const pre of preBlocks) {
    pre.className = 'rounded-lg bg-gray-900 dark:bg-gray-950 p-3 my-1 overflow-x-auto text-sm leading-relaxed'
    const code = pre.querySelector('code')
    if (code) {
      // Preserve any existing language class, add base text color
      const existingClasses = code.className
        .split(' ')
        .filter((c) => c.startsWith('language-'))
        .join(' ')
      code.className = `text-gray-100 ${existingClasses}`.trim()
    }
  }

  return container.innerHTML
}

export function renderRichContent(content: string, formattedContent: string | null): string {
  // If Matrix HTML formatted_body is available, sanitize and use it
  if (formattedContent) {
    const sanitized = DOMPurify.sanitize(formattedContent, PURIFY_CONFIG_FORMATTED)
    return highlightCodeBlocks(sanitized)
  }

  // Parse markdown from plain text
  let html = escapeHtml(content)

  // Code blocks (```) — limit content to 50k chars to prevent backtracking
  html = html.replace(/```(\w*)\n?([\s\S]{0,50000}?)```/g, '<pre><code>$2</code></pre>')
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Bold (**text** or __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
  // Italic (*text* or _text_) — use [^*] and [^_] to prevent backtracking
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>')
  // Strikethrough (~~text~~)
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // Links (auto-detect URLs)
  html = html.replace(
    /(?<!")https?:\/\/[^\s<]+/g,
    '<a href="$&" target="_blank" rel="noopener noreferrer">$&</a>'
  )

  const sanitized = DOMPurify.sanitize(html, PURIFY_CONFIG_PLAIN)
  return highlightCodeBlocks(sanitized)
}

/** Highlight search term in HTML string — DOM-based to avoid corrupting tag attributes (XSS safe) */
export function applySearchHighlight(html: string, term: string): string {
  if (!term || term.length < 2) return html
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'gi')

  const container = document.createElement('div')
  container.innerHTML = html

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }

  for (const node of textNodes) {
    const text = node.textContent || ''
    if (!regex.test(text)) continue
    regex.lastIndex = 0

    const frag = document.createDocumentFragment()
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }
      const mark = document.createElement('mark')
      mark.className = 'rounded-sm bg-yellow-300/80 text-inherit dark:bg-yellow-500/40'
      mark.textContent = match[0]
      frag.appendChild(mark)
      lastIndex = regex.lastIndex
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)))
    }
    node.parentNode!.replaceChild(frag, node)
  }

  return container.innerHTML
}
// Re-exported from shared util for backwards compatibility
export { EMOJI_ONLY_RE, isEmojiOnly } from "@/lib/emoji"

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<]+/)
  return match ? match[0] : null
}

/**
 * Extract the clean display name, stripping any Matrix ID disambiguation
 * that the SDK appends (e.g. "Łukasz (@signal_xxx:server.com)" → "Łukasz").
 */
export function parseDisplayName(senderName: string, senderId: string): { displayName: string; matrixId: string | null } {
  // If name contains " (@user:server)", strip it
  const match = senderName.match(/^(.+?)\s*\(@[^)]+\)$/)
  if (match) {
    return { displayName: match[1].trim(), matrixId: senderId }
  }
  // If name is just the raw Matrix ID, show it shortened
  if (senderName === senderId || senderName.startsWith('@')) {
    const localpart = senderId.replace(/^@/, '').split(':')[0]
    // Show clean localpart, full ID as subtitle
    return { displayName: localpart, matrixId: senderId }
  }
  // Clean name — hide Matrix ID for bridge users (signal_, telegram_, etc.) since it's just noise
  return { displayName: senderName, matrixId: null }
}
