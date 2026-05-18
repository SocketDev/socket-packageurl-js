/* Annotation-md cleanup orchestrator + homepage pill pass.
 *
 * For each .annotation-md container: mark ready (reveals the
 * opacity-0 placeholder), wrap JSDoc tags, group into blocks,
 * order. Schedules a second pass via rAF so any meander
 * hydration that landed later-in-the-same-tick gets swept too.
 *
 * Also runs tokenizeHomepagePills so the TOC + hero pills on
 * the index page share the same inline-code language as the
 * part pages.
 *
 * Gated on ns.onHljsReady so inline-code tokenization (which
 * calls window.hljs.highlightElement) has the grammar loaded.
 * Safe to no-op on pages without hljs content — onHljsReady
 * resolves immediately in that case. */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const cleanupAnnotationProse = () => {
    if (!ns.wrapJsdocTags || !ns.groupJsdocBlocks) {
      return
    }
    for (const container of document.querySelectorAll('.annotation-md')) {
      /* Mark the container as processed so CSS can reveal it.
       * `.annotation-md` ships hidden (opacity:0) to avoid a
       * flash of unstyled JSDoc markers — `@example` / `@param`
       * / etc. rendered as plain text for one frame before the
       * pills land. Setting the class at the START of the pass
       * (not end) lets the browser composite the cleaned DOM in
       * the same paint that this function's mutations commit to. */
      container.classList.add('wt-annotation-md-ready')
      ns.wrapJsdocTags(container)
      ns.groupJsdocBlocks(container)
    }
  }

  ns.onHljsReady(() => {
    cleanupAnnotationProse()
    requestAnimationFrame(cleanupAnnotationProse)
    /* Homepage TOC + hero intro inline code pills share the same
     * tokenizer so pills like `pkg:type/ns/name@version?q#sub`
     * and `Result<T, E>` pick up github-dark token colors on
     * both homepage and part surfaces. No-op if those selectors
     * don't match anything on the current page. */
    ns.tokenizeHomepagePills?.()
  })
})()
