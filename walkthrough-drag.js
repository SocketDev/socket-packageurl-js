/* Walkthrough interactivity:
 *   • Draggable splitter between prose and code columns (per file),
 *     updating --col-split on :root.
 *   • Theme toggle (light/dark) in the topbar, setting data-theme on
 *     <html>.
 * Both preferences persist to localStorage. Splitter uses Pointer
 * Events so the handle works with mouse, touch, and pen input. */
{
  const SPLIT_KEY = 'socket-walkthrough:col-split'
  const THEME_KEY = 'socket-walkthrough:theme'
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

  // Theme preference is one of 'system' | 'light' | 'dark'. 'system'
  // means no explicit pref — follow prefers-color-scheme. Stored as
  // THEME_KEY in localStorage (absent = system).
  const readStoredTheme = () => {
    const t = storageGet(THEME_KEY)
    return t === 'dark' || t === 'light' ? t : 'system'
  }
  const persistTheme = theme =>
    storageSet(THEME_KEY, theme === 'system' ? null : theme)

  const systemPrefersDark = () =>
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches

  // Resolve a preference ('system'|'light'|'dark') to the effective
  // theme that actually applies on <html>.
  const resolveTheme = pref =>
    pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref

  const applyTheme = theme => {
    document.documentElement.setAttribute('data-theme', theme)
  }

  // Current resolved theme (what <html data-theme> actually is).
  const currentResolved = () =>
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light'

  const installThemeToggle = () => {
    if (document.querySelector('.theme-toggle')) {
      return
    }
    const topbar = document.querySelector('.topbar')
    if (!topbar) {
      return
    }
    let host = topbar.querySelector('.topbar-actions')
    if (!host) {
      host = document.createElement('div')
      host.className = 'topbar-actions'
      topbar.appendChild(host)
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
          <span class="theme-menu-icon">${themeIconSvg(p)}</span>
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
    if (block.querySelector('.col-splitter')) {
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

    handle.addEventListener('pointerdown', event => {
      event.preventDefault()
      handle.setPointerCapture(event.pointerId)
      handle.classList.add('dragging')
      document.body.classList.add('col-resizing')

      const onMove = moveEvent => {
        const rect = block.getBoundingClientRect()
        if (rect.width === 0) {
          return
        }
        const pct = clamp(((moveEvent.clientX - rect.left) / rect.width) * 100)
        applySplit(pct)
        handle.setAttribute('aria-valuenow', String(Math.round(pct)))
      }

      const onEnd = () => {
        handle.releasePointerCapture(event.pointerId)
        handle.classList.remove('dragging')
        document.body.classList.remove('col-resizing')
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onEnd)
        handle.removeEventListener('pointercancel', onEnd)
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

    block.appendChild(handle)
  }

  const installAll = () => {
    for (const block of document.querySelectorAll('.file-block')) {
      attachHandle(block)
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

  // Wait for highlight.js to finish painting at least one code block
  // before allowing the content-reveal class to land. Prevents the
  // "plain pre → highlighted pre" flash when the CDN is slow. Resolves
  // immediately if there are no code blocks on the page (documents
  // tab) or if hljs has already run. 1.5s cap so slow CDNs don't
  // stall the reveal indefinitely.
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

  const ready = async () => {
    installAll()
    installThemeToggle()
    await waitForHljs()
    // Fallback reveal for pages with no comment shim (documents, or
    // walkthroughs with no commentBackend). When the shim IS present,
    // its init sets wt-ready after its async health probe. Both
    // paths are idempotent.
    if (!document.querySelector('script[src*="walkthrough-comments.js"]')) {
      document.body.classList.add('wt-ready')
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready)
  } else {
    ready()
  }
}
