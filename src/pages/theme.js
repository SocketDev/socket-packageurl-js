/* Theme toggle — system / light / dark / synthwave.
 *
 * Synchronous bits (resolve stored pref, apply to <html data-theme>,
 * install system-prefs observer) run immediately at load so there's
 * no flash of light theme on dark-preferring systems.
 *
 * The DOM-building bit (the topbar toggle menu) is registered as a
 * boot phase so it runs after DOMContentLoaded — that's when
 * `.part-nav` exists to host it. */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const THEME_KEY = 'socket-pages:theme'
  const { storageGet, storageSet } = ns

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
  const CHECK_SVG =
    '<svg class="theme-menu-check" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>'

  const readStoredTheme = () => {
    const t = storageGet(THEME_KEY)
    return t === 'dark' || t === 'light' || t === 'synthwave' ? t : 'system'
  }
  const persistTheme = theme =>
    storageSet(THEME_KEY, theme === 'system' ? null : theme)
  const systemPrefersDark = () =>
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolveTheme = pref =>
    pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
  const applyTheme = theme => {
    document.documentElement.setAttribute('data-theme', theme)
  }

  /* Apply stored or system-preferred theme synchronously to
   * avoid a flash of light theme on dark-preferring systems. */
  applyTheme(resolveTheme(readStoredTheme()))

  if (window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', event => {
      if (readStoredTheme() === 'system') {
        applyTheme(event.matches ? 'dark' : 'light')
      }
    })
  }

  let sparkTimer = 0
  const installThemeToggle = () => {
    if (document.querySelector('.theme-toggle')) {
      return
    }
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
    const toggleIcons = prefs
      .map(p => themeIconSvg(p, `theme-icon theme-icon-${p}`))
      .join('\n        ')
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
        /* Mark this as a user-initiated theme switch so CSS can
         * gate one-shot animations (e.g. the synthwave sparkles)
         * on it. Cleared after the animation window so a fresh
         * page load with synthwave stored in localStorage doesn't
         * re-fire the animation — only a live toggle does. */
        document.documentElement.classList.add('wt-theme-toggle-fired')
        clearTimeout(sparkTimer)
        sparkTimer = setTimeout(() => {
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

  ns.onReady(installThemeToggle)
})()
