/* Walkthrough boot — shared namespace + runtime primitives.
 *
 * Namespace: window[Symbol.for('socket-pages')]. Boot is the
 * first `<script defer>` in document order, so `ns` is always
 * populated by the time later modules run.
 *
 * Primitives:
 *   - ns.storageGet(key)        guarded localStorage read
 *   - ns.storageSet(key, value) guarded write (null ⇒ remove)
 *   - ns.onReady(fn)            run after DOMContentLoaded
 *   - ns.onHljsReady(fn)        run after hljs tokenizes
 *
 * Safari UA sniff: desktop/iOS Safari emits "…Safari/…" without
 * Chromium-family markers. Used so CSS can gate
 * `content-visibility: auto` off — Safari 18+ still has :target
 * / find-in-page glitches with it. */
{
  const ns = (window[Symbol.for('socket-pages')] ??= {})

  const ua = navigator.userAgent
  if (
    ua.includes('Safari/') &&
    !ua.includes('Chrome/') &&
    !ua.includes('Chromium/') &&
    !ua.includes('Edg/')
  ) {
    document.documentElement.setAttribute('data-ua', 'safari')
  }

  ns.storageGet = key => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  ns.storageSet = (key, value) => {
    try {
      if (value === null) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, value)
      }
    } catch {
      /* private mode / quota / disabled — ignore */
    }
  }

  const safe = (tag, fn) => {
    try {
      fn()
    } catch (e) {
      console.error(`[socket-pages] ${tag}:`, e)
    }
  }

  ns.onReady = fn => {
    const run = () => safe('onReady', fn)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true })
    } else {
      run()
    }
  }

  /* Wait for highlight.js to finish tokenizing the first
   * `.line-code` block so downstream passes operate on hljs's
   * final token tree — hljs splits text nodes, so any <a>/<span>
   * wrapped before it runs gets blown away. Resolves immediately
   * if there are no `.line-code` blocks (doc / index pages) or
   * hljs already ran. 1.5s cap + once-guard so a slow CDN can't
   * stall work, and the observer + timeout can't both fire. */
  ns.onHljsReady = fn => {
    ns.onReady(() => {
      const codes = document.querySelectorAll('.line-code code')
      let fired = false
      const once = () => {
        if (fired) {
          return
        }
        fired = true
        safe('onHljsReady', fn)
      }
      if (codes.length === 0 || codes[0].classList.contains('hljs')) {
        once()
        return
      }
      const obs = new MutationObserver(() => {
        if (codes[0].classList.contains('hljs')) {
          obs.disconnect()
          once()
        }
      })
      obs.observe(codes[0], { attributes: true, attributeFilter: ['class'] })
      setTimeout(() => {
        obs.disconnect()
        once()
      }, 1500)
    })
  }
}
