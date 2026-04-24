/* Cmd/Ctrl-click links inside code lines. Two flavors:
 *   - URLs: any http:// or https:// substring becomes an <a>
 *     that opens in a new tab when Cmd/Ctrl-clicked.
 *   - Cross-file paths: quoted strings (single or double quotes)
 *     whose resolved path matches another .file-block on this
 *     page, opened in the same window (scrolls to its anchor).
 *
 * The <a> is invisible (no underline, inherits color) until the
 * modifier key is held — then body.wt-mod-pressed flips on and
 * CSS reveals a dotted underline + pointer on hover. Click is
 * only honored while the modifier is held; a bare click does
 * nothing (doesn't disrupt code selection). Matches how DevTools
 * console + VS Code handle these.
 *
 * MUST run after highlight.js has tokenized the code so we walk
 * the already-highlighted span tree, not the raw text — hljs
 * splits text nodes, so any <a> we wrap before it runs would be
 * blown away. Uses `ns.onHljsReady` from boot.js to gate. */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const installSourceLinks = () => {
    const rawAnchors = document.body.getAttribute('data-file-anchors')
    const anchorByPath = new Map()
    if (rawAnchors) {
      try {
        const entries = JSON.parse(rawAnchors)
        for (const [p, a] of entries) {
          anchorByPath.set(p, a)
        }
      } catch {
        /* Malformed data — skip the cross-file wiring but keep
         * URL wrapping working. */
      }
    }

    /* Build a basename-swap fallback so `./compare.js` in source
     * resolves to `compare.ts` on disk. Keyed by `<dir>/<basename>`
     * without extension; value is the primary anchor. */
    const anchorByStem = new Map()
    for (const [path, anchor] of anchorByPath) {
      const stem = path.replace(/\.[a-z0-9]+$/i, '')
      if (!anchorByStem.has(stem)) {
        anchorByStem.set(stem, anchor)
      }
    }

    const resolveRelPath = (fromPath, ref) => {
      if (!ref.startsWith('./') && !ref.startsWith('../')) {
        return null
      }
      const fromDir = fromPath.split('/').slice(0, -1)
      const segs = ref.split('/')
      const out = [...fromDir]
      for (const seg of segs) {
        if (seg === '.' || seg === '') {
          continue
        }
        if (seg === '..') {
          out.pop()
        } else {
          out.push(seg)
        }
      }
      const resolved = out.join('/')
      if (anchorByPath.has(resolved)) {
        return anchorByPath.get(resolved)
      }
      const stem = resolved.replace(/\.[a-z0-9]+$/i, '')
      if (anchorByStem.has(stem)) {
        return anchorByStem.get(stem)
      }
      return null
    }

    const urlRe = /https?:\/\/[^\s'"`<>)]+/g
    const quotedPathRe = /(['"])(\.{1,2}\/[^'"`]+)\1/g

    const wrapMatches = (textNode, filePath) => {
      const text = textNode.nodeValue
      if (!text) {
        return
      }
      const matches = []
      for (const m of text.matchAll(urlRe)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          href: m[0],
          label: m[0],
          type: 'url',
        })
      }
      for (const m of text.matchAll(quotedPathRe)) {
        const pathRef = m[2]
        const anchor = filePath ? resolveRelPath(filePath, pathRef) : null
        if (!anchor) {
          continue
        }
        const innerStart = m.index + 1
        matches.push({
          start: innerStart,
          end: innerStart + pathRef.length,
          href: `#${anchor}`,
          label: pathRef,
          type: 'file',
        })
      }
      if (matches.length === 0) {
        return
      }
      matches.sort((a, b) => a.start - b.start)

      const parent = textNode.parentNode
      if (!parent) {
        return
      }
      let cursor = 0
      const frag = document.createDocumentFragment()
      for (const m of matches) {
        if (m.start < cursor) {
          continue
        }
        if (m.start > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, m.start)))
        }
        const a = document.createElement('a')
        a.className = 'wt-src-link'
        a.setAttribute('data-link-type', m.type)
        a.href = m.href
        if (m.type === 'url') {
          a.target = '_blank'
          a.rel = 'noopener noreferrer'
        }
        a.textContent = text.slice(m.start, m.end)
        frag.appendChild(a)
        cursor = m.end
      }
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)))
      }
      parent.replaceChild(frag, textNode)
    }

    for (const table of document.querySelectorAll('.code-table')) {
      const filePath = table.getAttribute('data-file')
      for (const cell of table.querySelectorAll('.line-code')) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        const textNodes = []
        let node = walker.nextNode()
        while (node) {
          textNodes.push(node)
          node = walker.nextNode()
        }
        for (const t of textNodes) {
          wrapMatches(t, filePath)
        }
      }
    }

    /* Modifier-key tracking — toggle body.wt-mod-pressed while
     * Cmd (macOS) or Ctrl (every other OS) is held. Dedupe:
     * auto-repeat keydown fires continuously while a key is
     * held. Re-toggling a body class re-matches .wt-src-link
     * selectors against every link on the page — wasteful when
     * the state is already what we want. */
    let modState = false
    const setMod = pressed => {
      if (modState === pressed) {
        return
      }
      modState = pressed
      document.body.classList.toggle('wt-mod-pressed', pressed)
    }
    const passive = { passive: true }
    addEventListener(
      'keydown',
      e => {
        if (e.key === 'Meta' || e.key === 'Control') {
          setMod(true)
        }
      },
      passive,
    )
    addEventListener(
      'keyup',
      e => {
        if (e.key === 'Meta' || e.key === 'Control') {
          setMod(false)
        }
      },
      passive,
    )
    addEventListener('blur', () => setMod(false), passive)

    /* Block plain clicks on source links; only the modifier-held
     * click should navigate. Check the native event's
     * metaKey/ctrlKey (not our body class) so the behavior stays
     * correct even if the key was pressed mid-click. */
    document.addEventListener('click', e => {
      const link = e.target.closest?.('.wt-src-link')
      if (!link) {
        return
      }
      if (!e.metaKey && !e.ctrlKey) {
        e.preventDefault()
      }
    })
  }

  ns.onHljsReady(installSourceLinks)
})()
