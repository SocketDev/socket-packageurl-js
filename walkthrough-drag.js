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

  const MOON_PATH =
    'M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.78.78 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278'
  const SUN_PATH =
    'M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8M8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0m0 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13M2.343 2.343a.75.75 0 0 1 1.061 0l1.06 1.061a.75.75 0 0 1-1.06 1.06l-1.06-1.06a.75.75 0 0 1 0-1.06m9.193 9.193a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061M16 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8M3 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8m10.657-5.657a.75.75 0 0 1 0 1.061l-1.061 1.06a.75.75 0 1 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.061 0m-9.193 9.193a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0'

  const clamp = n => {
    if (n < MIN) {
      return MIN
    }
    if (n > MAX) {
      return MAX
    }
    return n
  }

  const readStored = () => {
    try {
      const v = parseFloat(localStorage.getItem(SPLIT_KEY) || '')
      return isFinite(v) && v >= MIN && v <= MAX ? v : null
    } catch {
      return null
    }
  }

  const persist = value => {
    try {
      localStorage.setItem(SPLIT_KEY, String(value))
    } catch {
      /* private mode, quota, disabled — ignore */
    }
  }

  const readStoredTheme = () => {
    try {
      const t = localStorage.getItem(THEME_KEY)
      return t === 'dark' || t === 'light' ? t : null
    } catch {
      return null
    }
  }

  const persistTheme = theme => {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }

  const systemPrefersDark = () =>
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches

  const applyTheme = theme => {
    document.documentElement.setAttribute('data-theme', theme)
  }

  const currentTheme = () =>
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light'

  const iconSvg = paths => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('aria-hidden', 'true')
    for (const d of paths) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', d)
      svg.appendChild(p)
    }
    return svg
  }

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

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'theme-toggle'
    btn.setAttribute('aria-label', 'Toggle dark mode')
    btn.title = 'Toggle dark mode'

    const moon = iconSvg([MOON_PATH])
    const sun = iconSvg([SUN_PATH])
    const render = () => {
      const dark = currentTheme() === 'dark'
      btn.replaceChildren(dark ? sun : moon)
      btn.setAttribute('aria-pressed', String(dark))
    }
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      persistTheme(next)
      render()
    })
    render()
    /* Peer insert at the start of .topbar-actions so order is:
     * theme, export, unresolved. We don't move meander's buttons —
     * their scripts require them to stay where they are. */
    host.prepend(btn)
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

  /* Apply stored / preferred theme synchronously to avoid a flash
   * of light theme on dark-preferring systems. */
  const storedTheme = readStoredTheme()
  if (storedTheme !== null) {
    applyTheme(storedTheme)
  } else if (systemPrefersDark()) {
    applyTheme('dark')
  } else {
    applyTheme('light')
  }

  /* React to system theme changes when the user hasn't pinned a
   * preference. */
  if (window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', event => {
      if (readStoredTheme() === null) {
        applyTheme(event.matches ? 'dark' : 'light')
        const toggle = document.querySelector('.theme-toggle')
        if (toggle) {
          toggle.setAttribute('aria-pressed', String(event.matches))
        }
      }
    })
  }

  const storedSplit = readStored()
  if (storedSplit !== null) {
    applySplit(storedSplit)
  }

  const ready = () => {
    installAll()
    installThemeToggle()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready)
  } else {
    ready()
  }
}
