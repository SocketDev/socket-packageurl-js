/**
 * Socket walkthrough — comment UI + email magic-code auth.
 *
 * Replaces meander's inlined comment scripts (comment-client.js,
 * line-select.js, unresolved-comments.js, export-comments.js) entirely.
 * The build post-processor strips those blocks and injects this file
 * in their place.
 *
 * Reads meander's DOM markers verbatim:
 *   document.body[data-slug]           — walkthrough slug
 *   document.body[data-part]           — current part id
 *   document.body[data-page-type]      — "part" | "documents"
 *   table.code-table[data-file]        — file path for a code block
 *   td.line-num                        — line-number cells
 *   .topbar-actions                    — action-button container
 *
 * Backend URL comes from window.socketWalkthrough.backend (injected
 * at build time from walkthrough.json's commentBackend field).
 */
{
  const cfg = window.socketWalkthrough || {}
  const BACKEND = (cfg.backend || '').replace(/\/+$/, '')
  const JWT_KEY = 'socket-walkthrough:jwt'
  const EMAIL_KEY = 'socket-walkthrough:email'

  const slug = document.body.getAttribute('data-slug') || ''
  const partId = Number.parseInt(
    document.body.getAttribute('data-part') || '',
    10,
  )
  const isDocPage = document.body.getAttribute('data-page-type') === 'documents'

  const state = {
    jwt: null,
    email: null,
    comments: [],
    unresolvedCount: 0,
    backendReachable: null,
    expandedGroups: new Set(),
    selection: null,
  }

  /* ─── storage ─────────────────────────────────────────────────── */

  const loadJwt = () => {
    try {
      state.jwt = localStorage.getItem(JWT_KEY) || null
      state.email = localStorage.getItem(EMAIL_KEY) || null
    } catch {
      /* private-mode — ignore */
    }
  }
  const saveJwt = (jwt, email) => {
    state.jwt = jwt
    state.email = email
    try {
      if (jwt) {
        localStorage.setItem(JWT_KEY, jwt)
        localStorage.setItem(EMAIL_KEY, email)
      } else {
        localStorage.removeItem(JWT_KEY)
        localStorage.removeItem(EMAIL_KEY)
      }
    } catch {
      /* ignore */
    }
  }

  /* ─── fetch helper ────────────────────────────────────────────── */

  const api = async (path, init = {}) => {
    if (!BACKEND) {
      throw new Error('no-backend')
    }
    const headers = new Headers(init.headers || {})
    if (state.jwt) {
      headers.set('Authorization', `Bearer ${state.jwt}`)
    }
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const res = await fetch(BACKEND + path, { ...init, headers })
    if (res.status === 401) {
      saveJwt(null, null)
      throw new Error('unauthorized')
    }
    return res
  }

  const apiJson = async (path, init) => {
    const res = await api(path, init)
    if (!res.ok) {
      throw new Error(`http_${res.status}`)
    }
    const ct = res.headers.get('content-type') || ''
    return ct.includes('json') ? res.json() : res.text()
  }

  /* ─── auth: email → code flow ─────────────────────────────────── */

  const showModal = content => {
    const existing = document.querySelector('.wt-modal-overlay')
    if (existing) {
      existing.remove()
    }
    const overlay = document.createElement('div')
    overlay.className = 'wt-modal-overlay'
    overlay.innerHTML = `
      <div class="wt-modal" role="dialog" aria-modal="true" aria-labelledby="wt-modal-title">
        <button class="wt-modal-close" aria-label="Close">×</button>
        ${content}
      </div>
    `
    document.body.appendChild(overlay)
    const escHandler = e => {
      if (e.key === 'Escape') {
        close()
      }
    }
    const close = () => {
      overlay.remove()
      document.removeEventListener('keydown', escHandler)
    }
    overlay.querySelector('.wt-modal-close').addEventListener('click', close)
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        close()
      }
    })
    document.addEventListener('keydown', escHandler)
    return { overlay, close }
  }

  const runAuthFlow = () =>
    new Promise(resolve => {
      const { overlay, close } = showModal(`
        <h2 id="wt-modal-title" class="wt-modal-title">Sign in to comment</h2>
        <p class="wt-modal-sub">Enter your Socket email to get a 6-digit login code.</p>
        <form class="wt-form" data-step="email">
          <label class="wt-label">Email
            <input type="email" name="email" required autocomplete="username"
              data-1p-ignore data-lpignore="true" data-form-type="other"
              placeholder="you@socket.dev" class="wt-input"/>
          </label>
          <button type="submit" class="wt-primary">Send code</button>
          <p class="wt-error" aria-live="polite"></p>
        </form>
      `)
      const form = overlay.querySelector('.wt-form')
      const errEl = overlay.querySelector('.wt-error')
      // Set prefill via the DOM API, never string interpolation — cheap
      // defense-in-depth against a poisoned localStorage value.
      const emailInput = form.querySelector('input[name="email"]')
      if (state.email) {
        emailInput.value = state.email
      }
      let pendingEmail = ''

      const showStep2 = email => {
        pendingEmail = email
        form.setAttribute('data-step', 'code')
        form.innerHTML = `
          <p class="wt-modal-sub">Check your inbox for a 6-digit code sent to
            <strong class="wt-code-target"></strong>.</p>
          <label class="wt-label">Code
            <input type="text" name="code" required inputmode="numeric"
              pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"
              data-1p-ignore data-lpignore="true" data-form-type="other"
              class="wt-input wt-code" placeholder="123456"/>
          </label>
          <button type="submit" class="wt-primary">Verify</button>
          <button type="button" class="wt-secondary wt-back">Back</button>
          <p class="wt-error" aria-live="polite"></p>
        `
        // Set the email display via textContent, not string interp.
        const target = form.querySelector('.wt-code-target')
        if (target) {
          target.textContent = email
        }
        const codeInput = form.querySelector('.wt-code')
        codeInput.focus()
        // Auto-submit as soon as 6 digits land (paste or typing). Success
        // closes the modal silently; failure stays silent — the user is
        // still typing, so no error text is shown and the button stays
        // available for an explicit click.
        codeInput.addEventListener('input', () => {
          const v = codeInput.value.replace(/\D/g, '').slice(0, 6)
          if (v !== codeInput.value) {
            codeInput.value = v
          }
          if (v.length === 6) {
            form.dataset.auto = '1'
            form.requestSubmit()
          }
        })
        form.querySelector('.wt-back').addEventListener('click', () => {
          close()
          resolve(runAuthFlow())
        })
      }

      form.addEventListener('submit', async e => {
        e.preventDefault()
        errEl.textContent = ''
        const data = new FormData(form)
        const step = form.getAttribute('data-step')
        const btn = form.querySelector('button[type=submit]')
        btn.disabled = true
        try {
          if (step === 'email') {
            const email = String(data.get('email') || '')
              .trim()
              .toLowerCase()
            if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
              throw new Error('Enter a valid email address.')
            }
            const res = await fetch(BACKEND + '/auth/request', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email }),
            })
            if (!res.ok) {
              throw new Error('Could not send code. Try again.')
            }
            showStep2(email)
          } else {
            const code = String(data.get('code') || '').trim()
            if (!/^\d{6}$/.test(code)) {
              throw new Error('Enter the 6-digit code.')
            }
            const res = await fetch(BACKEND + '/auth/verify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: pendingEmail, code }),
            })
            if (res.status === 429) {
              throw new Error('Too many attempts. Try again later.')
            }
            if (!res.ok) {
              throw new Error('Invalid or expired code.')
            }
            const session = await res.json()
            saveJwt(session.token, session.email)
            close()
            resolve(true)
          }
        } catch (err) {
          // Silent failure on auto-submit — user is still typing, don't
          // flash errors at them. Explicit click still shows the error.
          const isAuto = form.dataset.auto === '1'
          if (!isAuto) {
            const errEl2 = form.querySelector('.wt-error')
            errEl2.textContent = err.message || String(err)
          }
          btn.disabled = false
        } finally {
          delete form.dataset.auto
        }
      })

      form.querySelector('input[name=email]')?.focus()
    })

  const ensureAuth = async () => {
    if (state.jwt) {
      return true
    }
    return runAuthFlow()
  }

  const silentCheck = async () => {
    if (!state.jwt) {
      return false
    }
    try {
      const res = await fetch(BACKEND + '/auth/check', {
        headers: { Authorization: `Bearer ${state.jwt}` },
      })
      if (!res.ok) {
        saveJwt(null, null)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  const healthProbe = async () => {
    if (!BACKEND) {
      return false
    }
    // 2-second cap so a cold-starting val doesn't keep the page
    // invisible forever; we'll treat a timeout as "offline" and
    // gracefully degrade comments UI.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2000)
    try {
      const res = await fetch(BACKEND + '/health', {
        method: 'GET',
        signal: ctrl.signal,
      })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /* ─── selection (shift-click line range) ──────────────────────── */

  let anchorLine = null

  const getLineInfo = el => {
    const td = el.closest?.('td.line-num')
    if (!td) {
      return null
    }
    const row = td.closest('tr')
    const table = td.closest('table.code-table')
    if (!row || !table) {
      return null
    }
    const file = table.getAttribute('data-file') || ''
    const line = Number.parseInt(td.textContent.trim(), 10)
    if (!Number.isFinite(line)) {
      return null
    }
    return { file, line, row, table }
  }

  const clearSelectionUi = () => {
    for (const r of document.querySelectorAll(
      'tr.wt-selected, tr.wt-selected-range',
    )) {
      r.classList.remove('wt-selected', 'wt-selected-range')
    }
    document.querySelector('.wt-selection-popover')?.remove()
    state.selection = null
  }

  const applySelectionHighlight = (file, fromLine, toLine) => {
    clearSelectionUi()
    const [lo, hi] =
      fromLine <= toLine ? [fromLine, toLine] : [toLine, fromLine]
    const table = document.querySelector(
      `table.code-table[data-file="${CSS.escape(file)}"]`,
    )
    if (!table) {
      return
    }
    for (const tr of table.querySelectorAll('tr')) {
      const n = Number.parseInt(
        tr.querySelector('td.line-num')?.textContent.trim() || '',
        10,
      )
      if (!Number.isFinite(n)) {
        continue
      }
      if (n >= lo && n <= hi) {
        tr.classList.add(n === lo ? 'wt-selected' : 'wt-selected-range')
      }
    }
    state.selection = { file, lineFrom: lo, lineTo: hi }
    showSelectionPopover(file, lo, hi)
  }

  const showSelectionPopover = (file, lineFrom, lineTo) => {
    document.querySelector('.wt-selection-popover')?.remove()
    const table = document.querySelector(
      `table.code-table[data-file="${CSS.escape(file)}"]`,
    )
    if (!table) {
      return
    }
    const firstSelectedRow = table.querySelector('tr.wt-selected')
    if (!firstSelectedRow) {
      return
    }
    const rect = firstSelectedRow.getBoundingClientRect()
    const pop = document.createElement('div')
    pop.className = 'wt-selection-popover'
    pop.innerHTML = `
      <span class="wt-sel-label">Lines ${lineFrom}${lineTo !== lineFrom ? '–' + lineTo : ''}</span>
      <button type="button" class="wt-primary wt-sel-comment">Add comment</button>
      <button type="button" class="wt-secondary wt-sel-cancel">Cancel</button>
    `
    Object.assign(pop.style, {
      position: 'absolute',
      top: `${window.scrollY + rect.top - 36}px`,
      left: `${window.scrollX + rect.left + 40}px`,
    })
    document.body.appendChild(pop)
    pop
      .querySelector('.wt-sel-cancel')
      .addEventListener('click', () => clearSelectionUi())
    pop.querySelector('.wt-sel-comment').addEventListener('click', async () => {
      if (!(await ensureAuth())) {
        return
      }
      pop.remove()
      showCommentForm(file, lineFrom, lineTo, null)
    })
  }

  const onLineClick = e => {
    const info = getLineInfo(e.target)
    if (!info) {
      return
    }
    if (e.shiftKey && anchorLine && anchorLine.file === info.file) {
      applySelectionHighlight(info.file, anchorLine.line, info.line)
    } else {
      anchorLine = { file: info.file, line: info.line }
      applySelectionHighlight(info.file, info.line, info.line)
    }
  }

  document.addEventListener('click', e => {
    if (e.target.closest?.('.wt-selection-popover')) {
      return
    }
    if (e.target.closest?.('td.line-num')) {
      onLineClick(e)
      return
    }
    // clicks outside selection + outside popover clear selection
    if (
      state.selection &&
      !e.target.closest?.('.wt-comment-form') &&
      !e.target.closest?.('table.code-table')
    ) {
      clearSelectionUi()
    }
  })

  /* ─── comment form ────────────────────────────────────────────── */

  const showCommentForm = (file, lineFrom, lineTo, parentId) => {
    document.querySelector('.wt-comment-form')?.remove()
    const form = document.createElement('form')
    form.className = 'wt-comment-form'
    form.innerHTML = `
      <div class="wt-comment-header">
        <strong>${file}</strong>
        <span>Lines ${lineFrom}${lineTo !== lineFrom ? '–' + lineTo : ''}</span>
      </div>
      <textarea class="wt-input wt-textarea" placeholder="Write a comment…" required maxlength="10000"></textarea>
      <div class="wt-row">
        <button type="submit" class="wt-primary">Post</button>
        <button type="button" class="wt-secondary wt-cancel">Cancel</button>
      </div>
      <p class="wt-error" aria-live="polite"></p>
    `
    // Insert adjacent to the selected row
    const table = document.querySelector(
      `table.code-table[data-file="${CSS.escape(file)}"]`,
    )
    const anchor = table?.querySelector('tr.wt-selected') || document.body
    anchor.parentNode.insertBefore(form, anchor.nextSibling)
    form.querySelector('textarea').focus()
    form
      .querySelector('.wt-cancel')
      .addEventListener('click', () => form.remove())
    form.addEventListener('submit', async e => {
      e.preventDefault()
      const body = form.querySelector('textarea').value.trim()
      if (!body) {
        return
      }
      const btn = form.querySelector('button[type=submit]')
      btn.disabled = true
      try {
        const payload = { part: partId, file, lineFrom, lineTo, body }
        if (parentId) {
          payload.parentId = parentId
        }
        const created = await apiJson(`/${slug}/api/comments`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        state.comments.push(created)
        state.expandedGroups.add(`${created.file}:${created.lineFrom}`)
        form.remove()
        clearSelectionUi()
        renderAll()
      } catch (err) {
        if (err.message === 'unauthorized') {
          const ok = await ensureAuth()
          if (ok) {
            form.querySelector('button[type=submit]').disabled = false
            form.requestSubmit()
          }
          return
        }
        form.querySelector('.wt-error').textContent =
          err.message === 'no-backend'
            ? 'Comments are offline.'
            : 'Could not post comment. Try again.'
        btn.disabled = false
      }
    })
  }

  /* ─── comment rendering ───────────────────────────────────────── */

  const renderAll = () => {
    // wipe previously-rendered cards + indicators
    for (const el of document.querySelectorAll('.wt-thread, .wt-indicator')) {
      el.remove()
    }

    // group comments by file:lineFrom; threading via parent_id
    const groups = new Map()
    for (const c of state.comments) {
      const key = `${c.file}:${c.lineFrom}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push(c)
    }

    for (const [key, group] of groups) {
      const [file, lineFromStr] = key.split(':')
      const lineFrom = Number.parseInt(lineFromStr, 10)
      const table = document.querySelector(
        `table.code-table[data-file="${CSS.escape(file)}"]`,
      )
      if (!table) {
        continue
      }
      let anchorRow = null
      for (const tr of table.querySelectorAll('tr')) {
        const n = Number.parseInt(
          tr.querySelector('td.line-num')?.textContent.trim() || '',
          10,
        )
        if (n === lineFrom) {
          anchorRow = tr
          break
        }
      }
      if (!anchorRow) {
        continue
      }

      // indicator dot
      const numCell = anchorRow.querySelector('td.line-num')
      if (numCell && !numCell.querySelector('.wt-indicator')) {
        const dot = document.createElement('span')
        dot.className = 'wt-indicator'
        const anyUnresolved = group.some(c => !c.parentId && !c.resolved)
        dot.classList.toggle('wt-indicator-open', anyUnresolved)
        dot.title = `${group.length} comment${group.length === 1 ? '' : 's'}`
        dot.addEventListener('click', e => {
          e.stopPropagation()
          if (state.expandedGroups.has(key)) {
            state.expandedGroups.delete(key)
          } else {
            state.expandedGroups.add(key)
          }
          renderAll()
        })
        numCell.appendChild(dot)
      }

      if (!state.expandedGroups.has(key)) {
        continue
      }

      // thread card
      const roots = group.filter(c => !c.parentId)
      const byParent = new Map()
      for (const c of group) {
        if (c.parentId) {
          if (!byParent.has(c.parentId)) {
            byParent.set(c.parentId, [])
          }
          byParent.get(c.parentId).push(c)
        }
      }
      for (const root of roots) {
        const card = document.createElement('div')
        card.className = 'wt-thread'
        card.appendChild(renderCommentCard(root, false))
        for (const reply of byParent.get(root.id) || []) {
          card.appendChild(renderCommentCard(reply, true))
        }
        // reply form
        const replyBtn = document.createElement('button')
        replyBtn.type = 'button'
        replyBtn.className = 'wt-secondary wt-reply-btn'
        replyBtn.textContent = 'Reply'
        replyBtn.addEventListener('click', async () => {
          if (!(await ensureAuth())) {
            return
          }
          showCommentForm(root.file, root.lineFrom, root.lineTo, root.id)
        })
        card.appendChild(replyBtn)
        anchorRow.parentNode.insertBefore(card, anchorRow.nextSibling)
      }
    }
  }

  const esc = s =>
    s.replace(
      /[&<>"']/g,
      c =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    )

  const renderCommentCard = (c, isReply) => {
    // Build with DOM APIs so author/body/timestamp flow through
    // textContent, not innerHTML — defense in depth against anything
    // slipping past the server-side sanitizer.
    const el = document.createElement('div')
    el.className = 'wt-comment' + (isReply ? ' wt-reply' : '')
    if (c.resolved) {
      el.classList.add('wt-resolved')
    }
    const meta = document.createElement('div')
    meta.className = 'wt-comment-meta'
    const who = document.createElement('strong')
    who.textContent = c.author || 'anonymous'
    const when = document.createElement('time')
    when.textContent = new Date(c.createdAt).toLocaleString()
    meta.append(who, when)
    if (c.resolved) {
      const badge = document.createElement('span')
      badge.className = 'wt-badge'
      badge.textContent = 'resolved'
      meta.append(badge)
    }
    const bodyEl = document.createElement('div')
    bodyEl.className = 'wt-comment-body'
    bodyEl.textContent = c.body || ''
    el.append(meta, bodyEl)

    const isAuthor = state.email && c.author === state.email
    if (isAuthor && !isReply) {
      const actions = document.createElement('div')
      actions.className = 'wt-actions'
      const resolveBtn = document.createElement('button')
      resolveBtn.type = 'button'
      resolveBtn.className = 'wt-secondary wt-resolve'
      resolveBtn.textContent = c.resolved ? 'Unresolve' : 'Resolve'
      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.className = 'wt-danger wt-delete'
      deleteBtn.textContent = 'Delete'
      actions.append(resolveBtn, deleteBtn)
      el.append(actions)
    }

    if (isAuthor) {
      el.querySelector('.wt-resolve')?.addEventListener('click', async () => {
        try {
          await apiJson(`/${slug}/api/comments/${c.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ resolved: !c.resolved }),
          })
          c.resolved = !c.resolved
          renderAll()
          refreshUnresolvedCount()
        } catch {
          /* toast? */
        }
      })
      el.querySelector('.wt-delete')?.addEventListener('click', async () => {
        if (!confirm('Delete this comment?')) {
          return
        }
        try {
          await apiJson(`/${slug}/api/comments/${c.id}`, { method: 'DELETE' })
          state.comments = state.comments.filter(x => x.id !== c.id)
          renderAll()
          refreshUnresolvedCount()
        } catch {
          /* */
        }
      })
    }
    return el
  }

  /* ─── unresolved + export ─────────────────────────────────────── */

  const refreshUnresolvedCount = async () => {
    try {
      const list = await apiJson(`/${slug}/api/comments/unresolved`)
      state.unresolvedCount = Array.isArray(list) ? list.length : 0
      const badge = document.querySelector('.wt-unresolved-badge')
      if (badge) {
        badge.textContent =
          state.unresolvedCount > 0 ? String(state.unresolvedCount) : ''
      }
    } catch {
      /* */
    }
  }

  const showUnresolvedDropdown = async (retry = 0) => {
    document.querySelector('.wt-dropdown')?.remove()
    let list = []
    try {
      list = await apiJson(`/${slug}/api/comments/unresolved`)
    } catch (err) {
      // Single retry on auth failure — prevents infinite recursion if
      // the freshly-issued token also gets 401'd.
      if (err.message === 'unauthorized' && retry < 1) {
        if (await ensureAuth()) {
          return showUnresolvedDropdown(retry + 1)
        }
      }
      return
    }
    const dd = document.createElement('div')
    dd.className = 'wt-dropdown wt-unresolved-dropdown'
    dd.innerHTML =
      list.length === 0
        ? '<div class="wt-dropdown-empty">No unresolved comments.</div>'
        : list
            .map(
              c => `
        <a class="wt-dropdown-item" href="#" data-file="${esc(c.file)}" data-line="${c.lineFrom}">
          <strong>${esc(c.author)}</strong>
          <span class="wt-dropdown-where">${esc(c.file)}:${c.lineFrom}</span>
          <span class="wt-dropdown-excerpt">${esc((c.body || '').slice(0, 80))}</span>
        </a>`,
            )
            .join('')
    document.body.appendChild(dd)
    positionDropdown(dd, '.wt-unresolved-btn')
    for (const a of dd.querySelectorAll('.wt-dropdown-item')) {
      a.addEventListener('click', e => {
        e.preventDefault()
        const file = a.getAttribute('data-file')
        const line = Number.parseInt(a.getAttribute('data-line'), 10)
        const table = document.querySelector(
          `table.code-table[data-file="${CSS.escape(file)}"]`,
        )
        const row = [...(table?.querySelectorAll('tr') || [])].find(
          tr =>
            Number.parseInt(
              tr.querySelector('td.line-num')?.textContent.trim() || '',
              10,
            ) === line,
        )
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        state.expandedGroups.add(`${file}:${line}`)
        renderAll()
        dd.remove()
      })
    }
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!dd.contains(e.target)) {
          dd.remove()
          document.removeEventListener('click', close)
        }
      })
    }, 0)
  }

  const showExportDropdown = async () => {
    document.querySelector('.wt-dropdown')?.remove()
    const dd = document.createElement('div')
    dd.className = 'wt-dropdown wt-export-dropdown'
    dd.innerHTML = `
      <button type="button" class="wt-dropdown-item" data-scope="all">Export all</button>
      <button type="button" class="wt-dropdown-item" data-scope="unresolved">Export unresolved</button>
    `
    document.body.appendChild(dd)
    positionDropdown(dd, '.wt-export-btn')
    for (const b of dd.querySelectorAll('.wt-dropdown-item')) {
      b.addEventListener('click', async () => {
        const scope = b.getAttribute('data-scope')
        try {
          const data = await apiJson(
            `/${slug}/api/comments/export${scope === 'unresolved' ? '?unresolved=1' : ''}`,
          )
          const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json',
          })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${slug}-comments-${scope}.json`
          a.click()
          URL.revokeObjectURL(url)
        } catch (err) {
          if (err.message === 'unauthorized') {
            if (await ensureAuth()) {
              return showExportDropdown()
            }
          }
        }
        dd.remove()
      })
    }
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!dd.contains(e.target)) {
          dd.remove()
          document.removeEventListener('click', close)
        }
      })
    }, 0)
  }

  const positionDropdown = (dd, triggerSel) => {
    const trigger = document.querySelector(triggerSel)
    if (!trigger) {
      return
    }
    const rect = trigger.getBoundingClientRect()
    Object.assign(dd.style, {
      position: 'absolute',
      top: `${window.scrollY + rect.bottom + 6}px`,
      right: `${window.innerWidth - rect.right}px`,
    })
  }

  /* ─── topbar buttons ──────────────────────────────────────────── */

  const installTopbarButtons = () => {
    const host = document.querySelector('.topbar-actions')
    if (!host || isDocPage) {
      return
    }

    // Export
    const exportBtn = document.createElement('button')
    exportBtn.type = 'button'
    exportBtn.className = 'wt-export-btn'
    exportBtn.setAttribute('aria-label', 'Export comments')
    exportBtn.title = 'Export comments'
    exportBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 11.5a.5.5 0 0 1-.5-.5V2.707L5.854 4.354a.5.5 0 1 1-.708-.708l2.5-2.5a.5.5 0 0 1 .708 0l2.5 2.5a.5.5 0 0 1-.708.708L8.5 2.707V11a.5.5 0 0 1-.5.5zM2 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4a.5.5 0 0 0-1 0v4H3v-4a.5.5 0 0 0-1 0v4z"/></svg>`
    exportBtn.addEventListener('click', async () => {
      if (!(await ensureAuth())) {
        return
      }
      showExportDropdown()
    })
    host.appendChild(exportBtn)

    // Unresolved
    const unresolvedBtn = document.createElement('button')
    unresolvedBtn.type = 'button'
    unresolvedBtn.className = 'wt-unresolved-btn'
    unresolvedBtn.setAttribute('aria-label', 'Unresolved comments')
    unresolvedBtn.title = 'Unresolved comments'
    unresolvedBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.355 2.03q.48-.19.934-.4c.334-.158.65-.32.94-.478a1 1 0 0 1 .788-.06 9 9 0 0 0 2.538.29c4.6 0 7.25-2.52 7.25-5.4S11.599 3.273 7 3.273s-7.25 2.52-7.25 5.4c0 1.293.525 2.482 1.431 3.413zm5.322 3.05c4.418 0 8-2.925 8-6.5s-3.582-6.5-8-6.5S0 4.869 0 8.444c0 1.445.579 2.76 1.575 3.813A11 11 0 0 1 .992 14.65c-.14.323-.12.704.064 1.002.183.297.516.48.866.474.35-.006.757-.07 1.166-.152q.614-.121 1.21-.307a9.5 9.5 0 0 0 .832-.305A10 10 0 0 0 8 15.944z"/>
      </svg>
      <span class="wt-unresolved-badge"></span>
    `
    unresolvedBtn.addEventListener('click', async () => {
      if (!(await ensureAuth())) {
        return
      }
      showUnresolvedDropdown()
    })
    host.appendChild(unresolvedBtn)
  }

  /* ─── init ───────────────────────────────────────────────────── */

  // Wait for highlight.js to finish before revealing — prevents the
  // plain-pre → highlighted-pre flash when the CDN is slow. 1.5s cap
  // so a stalled CDN doesn't keep the page hidden indefinitely.
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

  // Flag the body as ready so the topbar-actions cluster and content
  // area can reveal together. Called at every termination path of
  // init() so the UI never stays hidden.
  const markReady = async () => {
    await waitForHljs()
    document.body.classList.add('wt-ready')
  }

  const init = async () => {
    if (!BACKEND || !slug || isDocPage) {
      // Documents page has no comments; no backend = nothing to do.
      await markReady()
      return
    }
    if (!Number.isFinite(partId)) {
      await markReady()
      return
    }

    loadJwt()

    // Probe before wiring UI so we can hide affordances when backend is down.
    state.backendReachable = await healthProbe()
    if (!state.backendReachable) {
      document.body.classList.add('wt-backend-offline')
      await markReady()
      return
    }

    installTopbarButtons()

    // Silent auth check — if JWT is stale/expired, we clear it silently.
    // User will be prompted next time they try to comment. Skip entirely
    // when no JWT is present so we don't emit a gratuitous 401 in the
    // browser console on every page load for anonymous visitors.
    if (state.jwt) {
      const ok = await silentCheck()
      if (ok) {
        try {
          state.comments = await apiJson(`/${slug}/api/comments?part=${partId}`)
          renderAll()
          refreshUnresolvedCount()
        } catch {
          /* network blip or just-expired token — carry on */
        }
      }
    }

    await markReady()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}
