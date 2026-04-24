/* JSDoc tag wrapping — first half of the annotation-md cleanup.
 *
 * Takes the markdown meander rendered into .annotation-md and:
 *   1. Unwraps spurious mailto: links (meander auto-linker
 *      mistakes `name@x.y.z` for an email).
 *   2. Runs hljs over fenced @example blocks (language-javascript
 *      default) and routes inline <code> spans through the
 *      purl-tokenizer classification pass.
 *   3. Walks text nodes to wrap `@tag` tokens in
 *      <span class="wt-jsdoc-tag">, plus their optional
 *      `{Type}` annotation as <code class="wt-purl">.
 *
 * Exposes ns.wrapJsdocTags(container) so the group pass
 * (jsdoc-group.js) can call it in sequence. Kept separate so
 * each file handles one concern. */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const JSDOC_TAGS = new Set([
    'augments',
    'callback',
    'default',
    'deprecated',
    'description',
    'example',
    'extends',
    'fileoverview',
    'inheritdoc',
    'internal',
    'memberof',
    'module',
    'namespace',
    'override',
    'param',
    'private',
    'prop',
    'property',
    'protected',
    'public',
    'readonly',
    'return',
    'returns',
    'see',
    'since',
    'static',
    'template',
    'this',
    'throw',
    'throws',
    'type',
    'typedef',
  ])

  const unwrapMailto = container => {
    for (const a of container.querySelectorAll('a[href^="mailto:"]')) {
      a.replaceWith(document.createTextNode(a.textContent ?? ''))
    }
  }

  const highlightCode = container => {
    if (!window.hljs) {
      return
    }
    for (const code of container.querySelectorAll('pre > code')) {
      if (code.classList.contains('hljs')) {
        continue
      }
      const hasLang = Array.from(code.classList).some(c =>
        c.startsWith('language-'),
      )
      if (!hasLang) {
        /* Default `@example` fences without an explicit language
         * to JavaScript. Auto-detect is unreliable for short
         * snippets; JSDoc @example is always JS/TS. Blocks with
         * an explicit `language-*` class keep that language. */
        code.classList.add('language-javascript')
      }
      window.hljs.highlightElement(code)
    }
    ns.tokenizeInlineCodePills?.(container)
  }

  const wrapTagTokens = container => {
    /* Walk text nodes only so we don't disturb existing
     * <a>/<code>/<em> wrappers. A TreeWalker collects the
     * candidates first so we can mutate without invalidating
     * the iterator. */
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const textNodes = []
    let n = walker.nextNode()
    while (n) {
      /* Skip text inside nodes we've already processed (the tag
       * span itself) or inside code/pre elements (a `@foo` in
       * user code is not a JSDoc tag). Without this guard, a
       * second cleanup pass would re-wrap `@throws` inside its
       * existing .wt-jsdoc-tag span, producing nested pills. */
      const parent = n.parentElement
      if (parent && !parent.closest('.wt-jsdoc-tag, code, pre')) {
        textNodes.push(n)
      }
      n = walker.nextNode()
    }
    /* Match the @tag token plus an optional trailing JSDoc type
     * annotation in `{…}`. The tag itself (`@throws`) becomes a
     * muted `.wt-jsdoc-tag` span; the `{Type}` annotation becomes
     * a separate inline <code> so it reads as the code reference
     * it is. Any whitespace between tag and type is preserved
     * as a text node. */
    const tagPattern = /@([A-Za-z]+)\b(\s*)(\{[^}]*\})?/g
    for (const node of textNodes) {
      const text = node.nodeValue ?? ''
      if (!text.includes('@')) {
        continue
      }
      const parts = []
      let cursor = 0
      let m
      tagPattern.lastIndex = 0
      while ((m = tagPattern.exec(text)) !== null) {
        const tag = m[1].toLowerCase()
        if (!JSDOC_TAGS.has(tag)) {
          continue
        }
        if (m.index > cursor) {
          parts.push(document.createTextNode(text.slice(cursor, m.index)))
        }
        /* Break before so the pill never inlines after preceding
         * prose ("…unchanged. @param" → "…unchanged.<br>@param").
         * Skip if nothing precedes it in this fragment. */
        if (parts.length > 0 || cursor > 0) {
          parts.push(document.createElement('br'))
        }
        const tagSpan = document.createElement('span')
        tagSpan.className = 'wt-jsdoc-tag'
        tagSpan.textContent = '@' + m[1]
        tagSpan.dataset.tag = m[1].toLowerCase()
        parts.push(tagSpan)
        if (m[3]) {
          if (m[2]) {
            parts.push(document.createTextNode(m[2]))
          }
          const typeCode = document.createElement('code')
          typeCode.className = 'wt-purl'
          typeCode.textContent = m[3]
          parts.push(typeCode)
        }
        /* Break after so the body content drops to its own line. */
        parts.push(document.createElement('br'))
        cursor = m.index + m[0].length
        if (text[cursor] === ' ') {
          cursor += 1
        }
      }
      if (parts.length === 0) {
        continue
      }
      if (cursor < text.length) {
        parts.push(document.createTextNode(text.slice(cursor)))
      }
      const frag = document.createDocumentFragment()
      for (const p of parts) {
        frag.appendChild(p)
      }
      node.parentNode?.replaceChild(frag, node)
    }
  }

  ns.wrapJsdocTags = container => {
    unwrapMailto(container)
    highlightCode(container)
    wrapTagTokens(container)
  }
})()
