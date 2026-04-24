/* Sections navigation — the per-file-block dropdown that lists
 * each .annotation-card[id], plus the scroll-position observer
 * that tracks "which card am I reading" and lights the matching
 * menu row.
 *
 * Three subsystems:
 *   1. hydrateChip — the per-code-chunk chips emit an empty
 *      <div class="wt-sections-panel"></div> at build time to
 *      save ~(N-1)*N anchor elements per file on disk. First
 *      open clones the file-head's full menu into the chip.
 *   2. installSectionsMenuScrollSync — when a sections menu
 *      opens, scroll its .active row into the panel's visible
 *      area. Without this the panel opens scrolled to top.
 *      Also installs a document-level click listener that
 *      closes open menus when the user picks a link / clicks
 *      outside / opens a different menu.
 *   3. installSectionTracking — IntersectionObserver that
 *      watches each card's upper-viewport crossing and marks
 *      the topmost intersecting card as "current" in the
 *      file-head menu (NOT the chip panels — those have their
 *      active row baked in at build time). */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const hydratedChips = new WeakSet()
  const hydrateChip = chip => {
    if (hydratedChips.has(chip)) {
      return
    }
    hydratedChips.add(chip)
    const blockId = chip.getAttribute('data-sections-for')
    const activeId = chip.getAttribute('data-active-id')
    if (!blockId) {
      return
    }
    const block = document.getElementById(blockId)
    const src = block?.querySelector(
      '.file-head .wt-sections-menu .wt-sections-panel',
    )
    const dest = chip.querySelector('.wt-sections-panel')
    if (!src || !dest || dest.childElementCount > 0) {
      return
    }
    const clone = src.cloneNode(true)
    for (const a of clone.querySelectorAll('a.active')) {
      a.classList.remove('active')
    }
    if (activeId) {
      const match = clone.querySelector(`a[href="#${CSS.escape(activeId)}"]`)
      match?.classList.add('active')
    }
    dest.append(...clone.childNodes)
  }

  const installSectionsMenuScrollSync = () => {
    for (const menu of document.querySelectorAll('.wt-sections-menu')) {
      menu.addEventListener('toggle', () => {
        if (!menu.open) {
          return
        }
        if (menu.classList.contains('wt-section-chip')) {
          hydrateChip(menu)
        }
        const panel = menu.querySelector('.wt-sections-panel')
        const active = panel?.querySelector('a.active')
        if (!panel || !active) {
          return
        }
        const panelRect = panel.getBoundingClientRect()
        const activeRect = active.getBoundingClientRect()
        const centerOffset =
          activeRect.top -
          panelRect.top -
          panel.clientHeight / 2 +
          active.clientHeight / 2
        panel.scrollTop += centerOffset
      })
    }
    /* One CSS compound-selector covers both menu families —
     * :is() distributes the descendant combinator so we don't
     * repeat the union on every selector line. */
    const MENU = ':is(.wt-sections-menu, .wt-files-menu)'
    const PANEL_LINK = ':is(.wt-sections-panel, .wt-files-panel) a'
    document.addEventListener('click', e => {
      const target = e.target
      const panelLink = target.closest?.(PANEL_LINK)
      const summary = target.closest?.(`${MENU} > summary`)
      const clickedMenu = summary?.parentElement
      const insideMenu = target.closest?.(MENU)
      const closeAll = panelLink || (!insideMenu && !summary)
      for (const menu of document.querySelectorAll(`${MENU}[open]`)) {
        if (closeAll || (summary && menu !== clickedMenu)) {
          menu.open = false
        }
      }
    })
  }

  const installSectionTracking = () => {
    const menusByAnchor = new Map()
    for (const panel of document.querySelectorAll('.wt-sections-panel')) {
      for (const link of panel.querySelectorAll('a[href^="#"]')) {
        const id = link.getAttribute('href').slice(1)
        if (!id) {
          continue
        }
        let entry = menusByAnchor.get(id)
        if (!entry) {
          entry = { card: document.getElementById(id), panel, links: [] }
          menusByAnchor.set(id, entry)
        }
        entry.links.push(link)
      }
    }
    if (menusByAnchor.size === 0) {
      return
    }

    const currentByPanel = new WeakMap()
    const setActive = (panel, id) => {
      if (currentByPanel.get(panel) === id) {
        return
      }
      currentByPanel.set(panel, id)
      for (const link of panel.querySelectorAll('a.active')) {
        link.classList.remove('active')
      }
      if (id) {
        const entry = menusByAnchor.get(id)
        if (entry) {
          for (const link of entry.links) {
            if (link.parentElement === panel) {
              link.classList.add('active')
            }
          }
        }
      }
    }

    const visibleCards = new Set()
    const pickCurrentFor = panel => {
      let best = null
      let bestTop = Infinity
      for (const card of visibleCards) {
        if (!panel.closest('.file-block')?.contains(card)) {
          continue
        }
        const top = card.getBoundingClientRect().top
        if (top >= 0 && top < bestTop) {
          best = card
          bestTop = top
        }
      }
      /* Fallback: if nothing in the "good zone" above the
       * viewport edge is currently intersecting, pick whichever
       * visible card has the highest (closest-to-zero) negative
       * top — the last card the user scrolled past. */
      if (!best) {
        let bestNegTop = -Infinity
        for (const card of visibleCards) {
          if (!panel.closest('.file-block')?.contains(card)) {
            continue
          }
          const top = card.getBoundingClientRect().top
          if (top < 0 && top > bestNegTop) {
            best = card
            bestNegTop = top
          }
        }
      }
      setActive(panel, best?.id ?? null)
    }

    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleCards.add(entry.target)
          } else {
            visibleCards.delete(entry.target)
          }
        }
        /* Scroll-driven "current section" tracking applies only
         * to the file-head's whole-file sections menu — NOT to
         * the per-chunk chip panels. Each chip's panel has its
         * active row baked in at build time (the chunk's own
         * section) and should stay that way. */
        for (const panel of document.querySelectorAll('.wt-sections-panel')) {
          if (panel.closest('.wt-section-chip')) {
            continue
          }
          pickCurrentFor(panel)
        }
      },
      {
        rootMargin: '-20% 0px -70% 0px',
        threshold: 0,
      },
    )

    for (const { card } of menusByAnchor.values()) {
      if (card) {
        io.observe(card)
      }
    }
  }

  ns.onReady(() => {
    installSectionsMenuScrollSync()
    installSectionTracking()
  })
})()
