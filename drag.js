/* Walkthrough interactivity:
 *   • Draggable splitter between prose and code columns (per file),
 *     updating --col-split on :root.
 *   • Theme toggle (system/light/dark/synthwave) in the topbar,
 *     setting data-theme on <html>.
 * Both preferences persist to localStorage. Splitter uses Pointer
 * Events so the handle works with mouse, touch, and pen input. */
{
  /* Tag Safari so CSS can gate `content-visibility: auto` off —
   * Safari 18+ supports the property but still has known :target
   * / find-in-page glitches where hash-scrolling into a skipped
   * block fails to lay it out. Every other evergreen browser
   * handles it correctly, so only Safari gets the fallback
   * (`contain: layout` instead of the bigger `content-visibility`
   * win). UA sniff is narrow: Safari-the-browser, not any
   * WebKit-based engine — desktop/iOS Safari emits
   * "…Safari/…" without any of the Chromium-family markers. */
  const ua = navigator.userAgent
  if (
    ua.includes('Safari/') &&
    !ua.includes('Chrome/') &&
    !ua.includes('Chromium/') &&
    !ua.includes('Edg/')
  ) {
    document.documentElement.setAttribute('data-ua', 'safari')
  }

  const SPLIT_KEY = 'socket-pages:col-split'
  const THEME_KEY = 'socket-pages:theme'
  const DEFAULT_SPLIT = 50
  const MIN = 20
  const MAX = 80
  const SMALL_STEP = 1
  const LARGE_STEP = 5

  // Icon paths lifted from docs.socket.dev's ThemeToggle (24×24 viewBox).
  // Ray segments carry the `.theme-ray` class so they can animate
  // independently from the core sun/moon shape.
  //
  // `outline` / `solid` controls which SVG attr set each icon gets:
  //   outline — fill=none, stroke=currentColor (sun/moon rays, etc.)
  //   solid   — fill=currentColor (crescent moon filled shape)
  // `label` is the menu-row text.
  const OUTLINE_ATTRS =
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  const SOLID_ATTRS = 'fill="currentColor"'
  const THEME_ICONS = {
    system: {
      label: 'System',
      style: 'outline',
      path: `
    <path class="theme-ray" d="M12 2v2"/>
    <path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/>
    <path d="M16 12a4 4 0 0 0-4-4"/>
    <path class="theme-ray" d="m19 5-1.256 1.256"/>
    <path class="theme-ray" d="M20 12h2"/>
  `,
    },
    light: {
      label: 'Light',
      style: 'outline',
      path: `
    <path class="theme-ray" d="M12 1V3"/>
    <path class="theme-ray" d="M18.36 5.64L19.78 4.22"/>
    <path class="theme-ray" d="M21 12H23"/>
    <path class="theme-ray" d="M18.36 18.36L19.78 19.78"/>
    <path class="theme-ray" d="M12 21V23"/>
    <path class="theme-ray" d="M4.22 19.78L5.64 18.36"/>
    <path class="theme-ray" d="M1 12H3"/>
    <path class="theme-ray" d="M4.22 4.22L5.64 5.64"/>
    <path d="M12 17C14.7614 17 17 14.7614 17 12C17 9.23858 14.7614 7 12 7C9.23858 7 7 9.23858 7 12C7 14.7614 9.23858 17 12 17Z"/>
  `,
    },
    dark: {
      label: 'Dark',
      style: 'solid',
      path: `
    <path d="M19 14.79C18.8427 16.4922 18.2039 18.1144 17.1582 19.4668C16.1126 20.8192 14.7035 21.8458 13.0957 22.4265C11.4879 23.0073 9.74798 23.1181 8.0795 22.7461C6.41102 22.3741 4.88299 21.5345 3.67423 20.3258C2.46546 19.117 1.62594 17.589 1.25391 15.9205C0.881876 14.252 0.992717 12.5121 1.57346 10.9043C2.1542 9.29651 3.18083 7.88737 4.53321 6.84175C5.8856 5.79614 7.5078 5.15731 9.21 5C8.21341 6.34827 7.73385 8.00945 7.85853 9.68141C7.98322 11.3534 8.70386 12.9251 9.8894 14.1106C11.0749 15.2961 12.6466 16.0168 14.3186 16.1415C15.9906 16.2662 17.6517 15.7866 19 14.79Z"/>
    <path class="theme-star" d="M18.3707 1C18.3707 3.22825 16.2282 5.37069 14 5.37069C16.2282 5.37069 18.3707 7.51313 18.3707 9.74138C18.3707 7.51313 20.5132 5.37069 22.7414 5.37069C20.5132 5.37069 18.3707 3.22825 18.3707 1Z"/>
  `,
    },
    synthwave: {
      label: 'Synthwave',
      style: 'solid',
      // Lightning bolt — emoji-shape zigzag. Top is a short
      // horizontal edge (not a point); the four "waist" vertices
      // split across two y-levels to give the Z its visible
      // horizontal mid-segment. Bolt sits low in the 24×24 frame
      // (y=3 to y=23) so sparkles have room to float above it.
      // Sparkles carry .wt-spark* classes so CSS can fade them in
      // independently — same pattern the moon icon uses for its
      // star. Each is a tiny 4-point diamond (cross) rotated via
      // an inline transform so the four spokes don't all point
      // axis-aligned.
      path: `
    <path d="M20 6 L14 6 L4 16 L11 16 L7 24 L20 13 L13 13 Z"/>
    <path class="wt-spark wt-spark-1" d="M5 2 L5.5 4.5 L8 5 L5.5 5.5 L5 8 L4.5 5.5 L2 5 L4.5 4.5 Z"/>
    <path class="wt-spark wt-spark-2" d="M22 6.5 L22.5 9 L25 9.5 L22.5 10 L22 12.5 L21.5 10 L19 9.5 L21.5 9 Z"/>
    <path class="wt-spark wt-spark-3" d="M3.5 17.5 L4 20 L6.5 20.5 L4 21 L3.5 23.5 L3 21 L0.5 20.5 L3 20 Z"/>
  `,
    },
  }
  const themeIconSvg = (pref, extraClass = '') => {
    const { style, path } = THEME_ICONS[pref]
    const attrs = style === 'solid' ? SOLID_ATTRS : OUTLINE_ATTRS
    const classAttr = extraClass ? ` class="${extraClass}"` : ''
    return `<svg${classAttr} viewBox="0 0 24 24" aria-hidden="true" ${attrs}>${path}</svg>`
  }
  // Check glyph shared by every menu row — shown for the active pref
  // only (CSS toggles opacity based on aria-checked).
  const CHECK_SVG =
    '<svg class="theme-menu-check" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>'

  const clamp = n => {
    if (n < MIN) {
      return MIN
    }
    if (n > MAX) {
      return MAX
    }
    return n
  }

  // localStorage wrappers — private mode / quota / disabled all throw,
  // so every access has to be guarded. One pair of helpers keeps the
  // try/catch in one place. `storageSet(key, null)` removes the key.
  const storageGet = key => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const storageSet = (key, value) => {
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

  const readStored = () => {
    const v = parseFloat(storageGet(SPLIT_KEY) || '')
    return isFinite(v) && v >= MIN && v <= MAX ? v : null
  }
  const persist = value => storageSet(SPLIT_KEY, String(value))

  // Theme preference is one of 'system' | 'light' | 'dark' | 'synthwave'.
  // 'system' means no explicit pref — follow prefers-color-scheme.
  // Stored as THEME_KEY in localStorage (absent = system).
  const readStoredTheme = () => {
    const t = storageGet(THEME_KEY)
    return t === 'dark' || t === 'light' || t === 'synthwave' ? t : 'system'
  }
  const persistTheme = theme =>
    storageSet(THEME_KEY, theme === 'system' ? null : theme)

  const systemPrefersDark = () =>
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches

  // Resolve a preference ('system'|'light'|'dark'|'synthwave') to the
  // effective theme that actually applies on <html>. 'synthwave' passes
  // through — it's its own palette, not a light/dark variant.
  const resolveTheme = pref =>
    pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref

  const applyTheme = theme => {
    document.documentElement.setAttribute('data-theme', theme)
  }

  // Current resolved theme (what <html data-theme> actually is).
  const currentResolved = () => {
    const t = document.documentElement.getAttribute('data-theme')
    return t === 'dark' || t === 'synthwave' ? t : 'light'
  }

  const installThemeToggle = () => {
    if (document.querySelector('.theme-toggle')) {
      return
    }
    // Actions (theme toggle, export, comments) cluster on the right
    // side of the part-nav strip — the topbar itself is now just the
    // wordmark. Keeps all interactive chrome in one band.
    const partNav = document.querySelector('.part-nav')
    if (!partNav) {
      return
    }
    let host = partNav.querySelector('.topbar-actions')
    if (!host) {
      host = document.createElement('div')
      host.className = 'topbar-actions'
      partNav.appendChild(host)
    }

    const prefs = Object.keys(THEME_ICONS)
    // Compound toggle button — all three icons stacked; CSS picks one
    // to show based on the wrapper's data-pref attribute. Each icon
    // carries its own `.theme-icon theme-icon-<pref>` class for CSS.
    const toggleIcons = prefs
      .map(p => themeIconSvg(p, `theme-icon theme-icon-${p}`))
      .join('\n        ')
    // One menu row per preference.
    const menuItems = prefs
      .map(
        p => `
        <button type="button" role="menuitemradio" class="theme-menu-item" data-pref="${p}">
          <span class="theme-menu-icon theme-menu-icon-${p}">${themeIconSvg(p)}</span>
          <span>${THEME_ICONS[p].label}</span>
          ${CHECK_SVG}
        </button>`,
      )
      .join('')

    const wrapper = document.createElement('div')
    wrapper.className = 'theme-toggle-wrapper'
    wrapper.innerHTML = `
      <button type="button"
        class="theme-toggle"
        aria-label="Toggle color scheme"
        aria-haspopup="menu"
        aria-expanded="false"
        title="Color scheme">
        ${toggleIcons}
      </button>
      <div class="theme-menu" role="menu" hidden>
        <div class="theme-menu-title">Color Scheme</div>${menuItems}
      </div>
    `
    const btn = wrapper.querySelector('.theme-toggle')
    const menu = wrapper.querySelector('.theme-menu')

    // Reflect current preference on the wrapper so CSS picks the right
    // icon to show and the right menu item to check.
    const render = () => {
      const pref = readStoredTheme()
      wrapper.setAttribute('data-pref', pref)
      for (const item of menu.querySelectorAll('.theme-menu-item')) {
        item.setAttribute(
          'aria-checked',
          String(item.getAttribute('data-pref') === pref),
        )
      }
    }

    const openMenu = () => {
      menu.hidden = false
      btn.setAttribute('aria-expanded', 'true')
      wrapper.classList.add('theme-menu-open')
    }
    const closeMenu = () => {
      menu.hidden = true
      btn.setAttribute('aria-expanded', 'false')
      wrapper.classList.remove('theme-menu-open')
    }
    const toggleMenu = () => (menu.hidden ? openMenu() : closeMenu())

    btn.addEventListener('click', toggleMenu)
    document.addEventListener('click', e => {
      if (!wrapper.contains(e.target)) {
        closeMenu()
      }
    })
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu()
        btn.focus()
      }
    })

    for (const item of menu.querySelectorAll('.theme-menu-item')) {
      item.addEventListener('click', () => {
        const pref = item.getAttribute('data-pref')
        persistTheme(pref)
        applyTheme(resolveTheme(pref))
        /* Mark this as a user-initiated theme switch so CSS can gate
         * one-shot animations (e.g. the synthwave sparkles) on it.
         * Cleared after the animation window so a fresh page load
         * with synthwave stored in localStorage doesn't re-fire the
         * animation — only a live toggle does. */
        document.documentElement.classList.add('wt-theme-toggle-fired')
        clearTimeout(installThemeToggle._sparkTimer)
        installThemeToggle._sparkTimer = setTimeout(() => {
          document.documentElement.classList.remove('wt-theme-toggle-fired')
        }, 2500)
        render()
        closeMenu()
        btn.focus()
      })
    }

    render()
    host.prepend(wrapper)
  }

  const applySplit = value => {
    document.documentElement.style.setProperty('--col-split', String(value))
  }

  const readCurrent = () => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--col-split')
      .trim()
    const n = parseFloat(raw)
    return isFinite(n) ? n : DEFAULT_SPLIT
  }

  const attachHandle = block => {
    /* Attach the splitter to the inner grid (not the outer file-block)
     * so the rail only spans the prose+code region — never overshooting
     * up into the file-head border or past the grid's bottom edge. */
    const grid = block.querySelector('.pair-grid, .file-grid')
    if (!grid) {
      return
    }
    if (grid.querySelector('.col-splitter')) {
      return
    }

    const handle = document.createElement('div')
    handle.className = 'col-splitter'
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-orientation', 'vertical')
    handle.setAttribute('aria-label', 'Resize prose and code columns')
    handle.setAttribute('aria-valuemin', String(MIN))
    handle.setAttribute('aria-valuemax', String(MAX))
    handle.setAttribute('aria-valuenow', String(readCurrent()))
    handle.tabIndex = 0

    /* Hotspot: a long soft glow positioned at the pointer during
     * drag. Sibling of the rail's pseudo. Positioned via
     * translate3d so the move lives on the GPU compositor path —
     * no layout, no paint per frame. rAF-throttled so pointermove
     * events firing faster than the refresh rate coalesce into a
     * single DOM write. */
    const hotspot = document.createElement('div')
    hotspot.className = 'col-hotspot'
    hotspot.setAttribute('aria-hidden', 'true')
    handle.appendChild(hotspot)

    /* Hot-path state captured at pointerdown so onMove never reads
     * the DOM (getBoundingClientRect after a style write forces a
     * synchronous layout). All reads happen once per drag here;
     * writes in onMove go straight to rAF-coalesced property sets. */
    let dragState = null
    let rafId = 0
    const flush = () => {
      rafId = 0
      if (!dragState) {
        return
      }
      const {
        pendingClientX,
        pendingClientY,
        gridLeft,
        gridWidth,
        handleTop,
        handleHeight,
      } = dragState
      if (pendingClientX !== null && gridWidth > 0) {
        const pct = clamp(((pendingClientX - gridLeft) / gridWidth) * 100)
        applySplit(pct)
        dragState.lastPct = pct
      }
      if (pendingClientY !== null && handleHeight > 0) {
        const y = Math.max(
          0,
          Math.min(handleHeight, pendingClientY - handleTop),
        )
        hotspot.style.transform = `translate3d(-50%, ${y}px, 0)`
      }
      dragState.pendingClientX = null
      dragState.pendingClientY = null
    }
    const scheduleFlush = () => {
      if (rafId === 0) {
        rafId = requestAnimationFrame(flush)
      }
    }

    handle.addEventListener('pointerdown', event => {
      event.preventDefault()
      handle.setPointerCapture(event.pointerId)
      /* Snapshot DOM geometry once — no reads in onMove. If the
       * layout changes mid-drag (unlikely, and only from our own
       * writes which don't affect handle/grid position on the Y
       * axis), we accept slight drift over forced-sync-layout
       * on every pointer frame. */
      const gridRect = grid.getBoundingClientRect()
      const handleRect = handle.getBoundingClientRect()
      dragState = {
        gridLeft: gridRect.left,
        gridWidth: gridRect.width,
        handleTop: handleRect.top,
        handleHeight: handleRect.height,
        pendingClientX: event.clientX,
        pendingClientY: event.clientY,
        lastPct: null,
      }
      scheduleFlush()
      handle.classList.add('dragging')
      document.body.classList.add('col-resizing')

      const onMove = moveEvent => {
        if (!dragState) {
          return
        }
        dragState.pendingClientX = moveEvent.clientX
        dragState.pendingClientY = moveEvent.clientY
        scheduleFlush()
      }

      const onEnd = () => {
        handle.releasePointerCapture(event.pointerId)
        handle.classList.remove('dragging')
        document.body.classList.remove('col-resizing')
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onEnd)
        handle.removeEventListener('pointercancel', onEnd)
        const finalPct = dragState?.lastPct ?? readCurrent()
        /* Update aria-valuenow only at the end — AT notifications on
         * every pointer frame are wasteful, and screen readers don't
         * usefully narrate mid-drag updates. */
        handle.setAttribute('aria-valuenow', String(Math.round(finalPct)))
        dragState = null
        if (rafId !== 0) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
        persist(readCurrent())
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onEnd)
      handle.addEventListener('pointercancel', onEnd)
    })

    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? LARGE_STEP : SMALL_STEP
      let next
      switch (event.key) {
        case 'ArrowLeft':
          next = readCurrent() - step
          break
        case 'ArrowRight':
          next = readCurrent() + step
          break
        case 'Home':
          next = MIN
          break
        case 'End':
          next = MAX
          break
        default:
          return
      }
      event.preventDefault()
      next = clamp(next)
      applySplit(next)
      persist(next)
      handle.setAttribute('aria-valuenow', String(Math.round(next)))
    })

    handle.addEventListener('dblclick', () => {
      applySplit(DEFAULT_SPLIT)
      persist(DEFAULT_SPLIT)
      handle.setAttribute('aria-valuenow', String(DEFAULT_SPLIT))
    })

    grid.appendChild(handle)
  }

  const installAll = () => {
    for (const block of document.querySelectorAll('.file-block')) {
      attachHandle(block)
    }
  }

  /* Section scroll-tracking. Each .file-block has a Sections menu
   * listing anchors to its `.annotation-card[id]` children; the
   * card closest to the top of the viewport gets marked as the
   * "current" section, and the matching <a> in the menu picks up
   * `.active` so the dropdown always shows where you are.
   *
   * IntersectionObserver fires as cards cross an upper-viewport
   * boundary. We use a rootMargin that shifts the observation
   * window down by 20% of viewport height — that way a card is
   * considered "current" once it crosses into the top fifth of the
   * page, which matches the intuitive "what am I reading" anchor.
   *
   * Clicking a menu link triggers a native anchor jump; when the
   * page settles, the observer fires and picks up the new
   * current-section automatically — no manual sync on click. */
  /* Hydrate each .wt-section-chip's empty panel by cloning the
   * file-head menu's list on first open. The build emits chips
   * with empty <div class="wt-sections-panel"></div> — expanding
   * them here (rather than inlining the full list in HTML) saves
   * ~(N-1)*N anchor elements per file on disk. We clone the DOM
   * subtree, mark the chip's data-active-id row as .active, and
   * stash in a WeakSet so we only hydrate once per chip. */
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

  /* Scroll the .active row of a sections panel into view the moment
   * a chip's <details> opens. Without this, the panel always opens
   * scrolled to the top — if the user is on section 28, they have
   * to scroll the dropdown manually to find where they are. Runs
   * on every section <details> regardless of whether it's a chip
   * or the file-head menu. */
  const installSectionsMenuScrollSync = () => {
    for (const menu of document.querySelectorAll('.wt-sections-menu')) {
      menu.addEventListener('toggle', () => {
        if (!menu.open) {
          return
        }
        /* Empty chip? Clone the file-head list now, then fall
         * through to the scroll-to-active logic below using the
         * freshly-populated DOM. */
        if (menu.classList.contains('wt-section-chip')) {
          hydrateChip(menu)
        }
        const panel = menu.querySelector('.wt-sections-panel')
        const active = panel?.querySelector('a.active')
        if (!panel || !active) {
          return
        }
        // Center the active row in the panel's visible area. The
        // panel has max-height + overflow-y:auto so we're scrolling
        // within that box, not the page.
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
  }

  /* Cmd/Ctrl-click links inside code lines. Two flavors:
   *   - URLs: any http:// or https:// substring becomes an <a> that
   *     opens in a new tab when Cmd/Ctrl-clicked.
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
   * Runs after highlight.js has tokenized the code so we walk the
   * already-highlighted span tree, not the raw text. Text nodes
   * inside hljs spans are safe to split and wrap. */
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
        // Malformed data — skip the cross-file wiring but keep URL
        // wrapping working.
      }
    }

    // Build a basename-swap fallback so `./compare.js` in source
    // resolves to `compare.ts` on disk. Keyed by `<dir>/<basename>`
    // without extension; value is the primary anchor.
    const anchorByStem = new Map()
    for (const [path, anchor] of anchorByPath) {
      const stem = path.replace(/\.[a-z0-9]+$/i, '')
      if (!anchorByStem.has(stem)) {
        anchorByStem.set(stem, anchor)
      }
    }

    const resolveRelPath = (fromPath, ref) => {
      // Strip quotes already — we receive the bare import string.
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
      // Collect all matches with their ranges, sort by start index,
      // then rebuild the node as [text, <a>, text, <a>, …]. Single
      // pass, no overlap handling needed since URLs don't overlap
      // quoted strings (quotes would bound a URL at ' or ").
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
        // Start/end bracket the INNER quoted text (not the quotes
        // themselves) so the visible quote chars stay in the code.
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

    // Walk every .code-table row and its text nodes. Each table
    // carries data-file with its source path — use that to resolve
    // relative imports on this line to known file anchors.
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

    // Modifier-key tracking — toggle body.wt-mod-pressed while
    // Cmd (macOS) or Ctrl (every other OS) is held. CSS reveals
    // the dotted-underline affordance on .wt-src-link only while
    // the modifier is pressed. keyup / blur clears the state so a
    // released-off-window keystroke doesn't leave it stuck on.
    /* Dedupe: auto-repeat keydown fires continuously while a key
     * is held. Re-toggling a body class re-matches .wt-src-link
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
    /* passive: true — these handlers never preventDefault, so
     * marking them passive lets the browser skip the "is this
     * going to block scrolling?" check on every key/blur event. */
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

    // Block plain clicks on source links; only the modifier-held
    // click should navigate. Check the native event's
    // metaKey/ctrlKey (not our body class) so the behavior stays
    // correct even if the key was pressed mid-click.
    document.addEventListener('click', e => {
      const link = e.target.closest?.('.wt-src-link')
      if (!link) {
        return
      }
      if (!e.metaKey && !e.ctrlKey) {
        e.preventDefault()
      }
      // With modifier: let the default <a> behavior fire (new tab
      // for type=url via target=_blank; same-window hash-jump for
      // type=file).
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

    // Per-panel current active id. Lets us swap cheaply without a
    // full panel scan on every observer fire.
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

    // Track which cards are currently intersecting the "current"
    // zone. When multiple are visible, the topmost wins — that's
    // the section most recently scrolled into view.
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
      // Fallback: if nothing in the "good zone" above the viewport
      // edge is currently intersecting, pick whichever visible card
      // has the highest (closest-to-zero) negative top — the last
      // card the user scrolled past. Tracks `bestNegTop` separately
      // starting at -Infinity; `bestTop` is still Infinity here, so
      // the old `bestTop - Infinity` compare was NaN and always
      // false — the fallback never fired.
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
        // Scroll-driven "current section" tracking applies only to
        // the file-head's whole-file sections menu — NOT to the
        // per-chunk chip panels. Each chip's panel has its active
        // row baked in at build time (the chunk's own section) and
        // should stay that way; re-applying scroll logic would
        // clobber the static highlight whenever the user scrolled
        // past that chunk. Filter out chip panels by walking up
        // to see if the panel lives inside a .wt-section-chip.
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

  /* Apply stored or system-preferred theme synchronously to avoid a
   * flash of light theme on dark-preferring systems. */
  applyTheme(resolveTheme(readStoredTheme()))

  /* When preference is 'system', follow prefers-color-scheme changes. */
  if (window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', event => {
      if (readStoredTheme() === 'system') {
        applyTheme(event.matches ? 'dark' : 'light')
      }
    })
  }

  const storedSplit = readStored()
  if (storedSplit !== null) {
    applySplit(storedSplit)
  }

  /* Wait until highlight.js has run on the first code block so
   * installSourceLinks can operate on the final token tree —
   * hljs splits text nodes, so any <a> we wrap before it runs
   * would be blown away. Resolves immediately if there are no
   * code blocks (doc pages) or hljs already ran. 1.5s cap so a
   * slow CDN doesn't stall link installation forever. */
  const waitForHljs = () =>
    new Promise(resolve => {
      const codes = document.querySelectorAll('.line-code code')
      if (codes.length === 0 || codes[0].classList.contains('hljs')) {
        resolve()
        return
      }
      const obs = new MutationObserver(() => {
        if (codes[0].classList.contains('hljs')) {
          obs.disconnect()
          resolve()
        }
      })
      obs.observe(codes[0], { attributes: true, attributeFilter: ['class'] })
      setTimeout(() => {
        obs.disconnect()
        resolve()
      }, 1500)
    })

  /* Tidy the prose that meander renders into .annotation-md at
   * page load. Two fixes:
   *   1. Meander's markdown auto-linker treats `name@x.y.z`
   *      (e.g. `core@7.0.0`) as an email and wraps it in a
   *      mailto: <a>. Unwrap those — they're package identifiers,
   *      not addresses. Check the href pattern rather than the
   *      text content so we don't accidentally un-link real
   *      emails if any show up.
   *   2. JSDoc tags (@param, @returns, @throws, @example,
   *      @fileoverview, etc.) at the start of a line are
   *      metadata markers, not primary prose. Wrap them in a
   *      <span class="wt-jsdoc-tag"> so CSS can tint them lighter
   *      and set them apart. Matches only the `@tagname` token,
   *      not `@scope` package names etc. */
  const JSDOC_TAGS = new Set([
    'param',
    'returns',
    'return',
    'throws',
    'throw',
    'example',
    'fileoverview',
    'see',
    'since',
    'deprecated',
    'default',
    'type',
    'typedef',
    'callback',
    'property',
    'prop',
    'template',
    'inheritdoc',
    'override',
    'private',
    'protected',
    'public',
    'readonly',
    'static',
    'augments',
    'extends',
    'module',
    'namespace',
    'memberof',
    'this',
  ])
  const cleanupAnnotationProse = () => {
    for (const container of document.querySelectorAll('.annotation-md')) {
      /* 1. Unwrap spurious mailto: links (meander auto-linker
       * misreading `name@version`). Replace the <a> node with
       * its text content. */
      for (const a of container.querySelectorAll('a[href^="mailto:"]')) {
        a.replaceWith(document.createTextNode(a.textContent ?? ''))
      }
      /* 2. Wrap JSDoc tags. Walk text nodes only so we don't
       * disturb existing <a>/<code>/<em> wrappers. A TreeWalker
       * collects the candidates first so we can mutate without
       * invalidating the iterator. */
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      const textNodes = []
      let n = walker.nextNode()
      while (n) {
        textNodes.push(n)
        n = walker.nextNode()
      }
      const tagPattern = /@([A-Za-z]+)\b/g
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
          const span = document.createElement('span')
          span.className = 'wt-jsdoc-tag'
          span.textContent = m[0]
          parts.push(span)
          cursor = m.index + m[0].length
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
  }

  const ready = async () => {
    installAll()
    installThemeToggle()
    installSectionTracking()
    installSectionsMenuScrollSync()
    await waitForHljs()
    // Source links run AFTER hljs — wrapping before would lose
    // our <a>s the moment hljs re-tokenizes the text nodes.
    installSourceLinks()
    /* Fixup meander's annotation render. Run once now, then
     * schedule a second pass via requestAnimationFrame so any
     * meander hydration that landed later-in-the-same-tick gets
     * swept too. rAF fires before the next paint, so neither
     * the user nor layout ever sees the un-cleaned state. */
    cleanupAnnotationProse()
    requestAnimationFrame(cleanupAnnotationProse)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready)
  } else {
    ready()
  }
}
