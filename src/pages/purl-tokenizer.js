/* PURL tokenizer + inline-code pill pass.
 *
 * `tokenizePurl(code, text)` hand-tokenizes a PURL string into
 * hljs-classed spans so the inline pill picks up github-dark
 * token colors. Emits:
 *   scheme    → .hljs-keyword   (`pkg:`)
 *   type      → .hljs-type      (`npm`)
 *   namespace → .hljs-attr      (`@babel`)
 *   name      → .hljs-title     (`core`)
 *   version   → .hljs-number    (`@7.0.0`)
 *   query     → .hljs-string    (`?x=y`)
 *   fragment  → .hljs-symbol    (`#sub`)
 * Text content goes in via DOM, not innerHTML — the input can
 * be user-controlled prose, so keeping it as text nodes + span
 * wrappers keeps the pass XSS-safe.
 *
 * `tokenizeInlineCodePills(root)` walks every `<code>` inside
 * `root` that isn't already in a `<pre>` or hljs-processed,
 * classifies each via purl-classifiers, and routes:
 *   PURL-shape   → tokenizePurl (keeps github-dark palette)
 *   bare ident   → .wt-purl (plain cream pill, no syntax)
 *   urlish       → .wt-purl (same)
 *   everything   → hljs as TypeScript (handles generics like
 *                  `Result<T, E>` that plain JS flat-colors).
 *
 * `tokenizeHomepagePills()` walks the index-page surfaces
 * (.wt-contents-summary rows, .wt-intro-line lines) so pills
 * on the homepage share the same language as part-page pills. */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const tokenizePurl = (code, text) => {
    code.classList.add('wt-purl', 'hljs')
    while (code.firstChild) {
      code.removeChild(code.firstChild)
    }
    const span = (cls, t) => {
      const s = document.createElement('span')
      s.className = cls
      s.textContent = t
      return s
    }
    const appendPlain = t => {
      code.appendChild(document.createTextNode(t))
    }
    /* Split on the well-known PURL delimiters in order:
     *   pkg: <type> / <ns>/<name> @<version> ?<query> #<subpath>
     * Only `pkg:` + type + name are required; everything else is
     * optional. If the string doesn't match the canonical form
     * (came in as a sketch like `pkg:type/ns/name@version?q#sub`),
     * fall back to splitting on the same delimiters but without
     * semantic assumptions — the pill still tokenizes cleanly. */
    const match = text.match(
      /^(pkg:)([A-Za-z][A-Za-z0-9.+-]*)(\/.+?)(@[^?#]+)?(\?[^#]+)?(#.+)?$/,
    )
    if (!match) {
      let rest = text
      const emit = (re, cls) => {
        const m = rest.match(re)
        if (m) {
          code.appendChild(span(cls, m[0]))
          rest = rest.slice(m[0].length)
        }
      }
      emit(/^pkg:/, 'hljs-keyword')
      emit(/^[A-Za-z][A-Za-z0-9.+-]*/, 'hljs-type')
      while (rest.length > 0) {
        if (rest.startsWith('/')) {
          appendPlain('/')
          rest = rest.slice(1)
          const segMatch = rest.match(/^[^/@?#]+/)
          if (segMatch) {
            code.appendChild(span('hljs-attr', segMatch[0]))
            rest = rest.slice(segMatch[0].length)
          }
        } else if (rest.startsWith('@')) {
          const m = rest.match(/^@[^?#]+/)
          if (m) {
            code.appendChild(span('hljs-number', m[0]))
            rest = rest.slice(m[0].length)
          } else {
            appendPlain(rest)
            rest = ''
          }
        } else if (rest.startsWith('?')) {
          const m = rest.match(/^\?[^#]+/)
          if (m) {
            code.appendChild(span('hljs-string', m[0]))
            rest = rest.slice(m[0].length)
          } else {
            appendPlain(rest)
            rest = ''
          }
        } else if (rest.startsWith('#')) {
          code.appendChild(span('hljs-symbol', rest))
          rest = ''
        } else {
          appendPlain(rest)
          rest = ''
        }
      }
      return
    }
    const [, scheme, type, path, version, query, fragment] = match
    code.appendChild(span('hljs-keyword', scheme))
    code.appendChild(span('hljs-type', type))
    /* Path is `/<ns>/<name>` or `/<name>` — split on the first
     * slash group so the last segment reads as the name and any
     * prior segments read as namespace. */
    const pathMatch = path.match(/^\/(.+)\/([^/]+)$/)
    if (pathMatch) {
      appendPlain('/')
      code.appendChild(span('hljs-attr', pathMatch[1]))
      appendPlain('/')
      code.appendChild(span('hljs-title', pathMatch[2]))
    } else {
      appendPlain('/')
      code.appendChild(span('hljs-title', path.slice(1)))
    }
    if (version) {
      code.appendChild(span('hljs-number', version))
    }
    if (query) {
      code.appendChild(span('hljs-string', query))
    }
    if (fragment) {
      code.appendChild(span('hljs-symbol', fragment))
    }
  }

  const tokenizeInlineCodePills = root => {
    if (!window.hljs) {
      return
    }
    const { looksLikePurl, looksLikeBareIdent, looksLikeUrlish } = ns
    for (const code of root.querySelectorAll('code')) {
      if (code.parentElement?.tagName === 'PRE') {
        continue
      }
      if (code.classList.contains('hljs')) {
        continue
      }
      const content = code.textContent ?? ''
      if (looksLikePurl(content)) {
        tokenizePurl(code, content)
        continue
      }
      if (looksLikeBareIdent(content) || looksLikeUrlish(content)) {
        code.classList.add('wt-purl')
        continue
      }
      /* Force `language-typescript` — TS understands generic
       * syntax (`Result<T, E>`, `Map<string, number>`); plain
       * JavaScript parses `<T` as less-than and flat-colors the
       * token. Auto-detect misreads short fluent-API spans
       * (`PurlBuilder.gitlab().name('x').build()`) as other
       * languages and tints them inconsistently. */
      code.classList.add('hljs-inline', 'language-typescript')
      window.hljs.highlightElement(code)
    }
  }

  const tokenizeHomepagePills = () => {
    for (const summary of document.querySelectorAll('.wt-contents-summary')) {
      tokenizeInlineCodePills(summary)
    }
    for (const line of document.querySelectorAll('.wt-intro-line')) {
      tokenizeInlineCodePills(line)
    }
  }

  ns.tokenizePurl = tokenizePurl
  ns.tokenizeInlineCodePills = tokenizeInlineCodePills
  ns.tokenizeHomepagePills = tokenizeHomepagePills
})()
