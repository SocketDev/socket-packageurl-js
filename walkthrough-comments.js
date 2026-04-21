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
    state.__refreshAuthUi?.()
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

  // HTML escape for the one spot that still uses string interpolation.
  // Everywhere else builds via textContent/DOM APIs; this stays only
  // for the dropdown body that's genuinely easier as a template.
  const esc = s =>
    String(s).replace(
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

  /* ─── auth: email → code flow ─────────────────────────────────── */

  // Use the native <dialog> element (showModal): browser handles focus
  // trapping, inert background, Escape-to-close, top-layer stacking,
  // role="dialog" + aria-modal=true, and a styleable ::backdrop. All
  // we add on top is the outside-click dismiss (comparing the click
  // target to the dialog itself — clicks on the backdrop bubble as
  // clicks on the dialog element).
  //
  // Returns { overlay, close } where `overlay` IS the <dialog> so
  // callers can still `.querySelector()` into the content, and `close`
  // dismisses it.
  const showModal = content => {
    // Replace any already-open dialog.
    const existing = document.querySelector('.wt-modal')
    if (existing && typeof existing.close === 'function') {
      existing.close()
      existing.remove()
    }
    const dialog = document.createElement('dialog')
    dialog.className = 'wt-modal'
    dialog.setAttribute('aria-labelledby', 'wt-modal-title')
    dialog.innerHTML = `
      <button class="wt-modal-close" aria-label="Close" type="button">×</button>
      ${content}
    `
    document.body.appendChild(dialog)

    const close = () => {
      if (dialog.open) {
        dialog.close()
      }
      dialog.remove()
    }

    dialog.querySelector('.wt-modal-close').addEventListener('click', close)

    // Outside-click dismiss. The ::backdrop is a child of the dialog
    // in the rendering tree, but click events on the backdrop surface
    // as clicks whose target === the dialog (not a descendant). So
    // checking `e.target === dialog` distinguishes backdrop from
    // content clicks.
    dialog.addEventListener('click', e => {
      if (e.target === dialog) {
        close()
      }
    })

    // UA fires `close` on Escape; ensure the node is removed after.
    dialog.addEventListener('close', () => dialog.remove())

    dialog.showModal()
    return { overlay: dialog, close }
  }

  // Two separate reject lists, one funny, one serious:
  //
  //   PLACEHOLDERS — decorative, rotate through the email input's
  //     placeholder on each modal open. Submitting one (or a close
  //     typo) bounces with a playful message.
  //
  //   REJECTED_NAMES — real-looking local-parts we never want a
  //     commenter to authenticate as: shared inboxes (security,
  //     support, press), role accounts (admin, hr, legal), bot
  //     identities (socket-bot, dependabot), and common pentest
  //     probes (test, demo, guest). These get rejected with a
  //     matter-of-fact error, not a joke — it's a security posture,
  //     not a bit. Fuzzy-match protects against "adm1n" / "secur1ty"
  //     style dodges.
  const PLACEHOLDERS = [
    'left.paddington@socket.dev',
    'popnlockfile@socket.dev',
    'rockem.sockem@socket.dev',
    'semiconfabulate@socket.dev',
    'semver.tantrum@socket.dev',
    'sufferin.succotash@socket.dev',
    'tabs4life@socket.dev',
  ]
  // Reserved stems — addresses that ARE valid inboxes but belong to
  // shared/role/bot/ecosystem accounts, not individual humans: role
  // accounts (admin, security, support), bot identities (dependabot,
  // socketbot), pentest probes (redteam, blueteam), package ecosystem
  // names (npm, pnpm, yarn), department mailers (billing, legal,
  // marketing). Rejected with a neutral "this address is reserved"
  // message — the user might legitimately have access to one, we just
  // don't want comments signed by a shared identity. Alphabetical.
  const RESERVED_STEMS_CLEAR = [
    'abuse',
    'account',
    'admin',
    'anonymous',
    'audit',
    'billing',
    'blueteam',
    'bot',
    'cicd',
    'contact',
    'dependabot',
    'doctor',
    'finance',
    'githubactions',
    'hostmaster',
    'info',
    'leftpad',
    'legal',
    'lodash',
    'lodasher',
    'marketing',
    'media',
    'noreply',
    'npm',
    'pentest',
    'pnpm',
    'postmaster',
    'press',
    'qa',
    'redteam',
    'renovate',
    'root',
    'sales',
    'security',
    'socket',
    'socketbot',
    'staff',
    'support',
    'team',
    'user',
    'webmaster',
    'yarn',
  ]
  // Bogus stems — joke, placeholder, gibberish-adjacent, or tantrum
  // words that no real person would use as their local-part. These
  // aren't reserved addresses — they're obvious non-answers, so the
  // validator surfaces them with the "doesn't look like a real
  // address" message (same as the gibberish detector) rather than
  // "this address is reserved". Alphabetical.
  const BOGUS_STEMS_CLEAR = [
    'asdf',
    'bogus',
    'demo',
    'dummy',
    'example',
    'fake',
    'faker',
    'foo',
    'foobar',
    'guest',
    'hack',
    'hacker',
    'hate',
    'hater',
    'hell',
    'hello',
    'help',
    'lol',
    'loser',
    'nope',
    'null',
    'ok',
    'okay',
    'placeholder',
    'qwerty',
    'sample',
    'stupid',
    'test',
    'testing',
    'undefined',
    'zzz',
  ]
  // Obscenities and slurs — base64-encoded so the source file doesn't
  // contain the literal words. Decoded once at load, never stored in
  // the clear in a global. Ripgrep/search in the repo won't match
  // them, and casual code review doesn't have to read them off the
  // screen. (Obfuscation, not security — determined readers can
  // trivially decode; that's fine, the goal is avoiding surprise.)
  //
  // To add or remove a word:
  //   btoa('badword')  → paste the result here
  //   or: Buffer.from('badword').toString('base64')
  // Sorted alphabetically by the decoded word so additions and
  // duplicates stay obvious. Covers profanity, body parts, and
  // slurs of various kinds.
  const BAD_WORDS = [
    'YXNz',
    'YXNzaG9sZQ==',
    'YmFzdGFyZA==',
    'Yml0Y2g=',
    'Ym9vdGxpY2tlcg==',
    'YnM=',
    'YnVsbHNoaXQ=',
    'Y29jaw==',
    'Y3JhcA==',
    'Y3Vjaw==',
    'Y3VudA==',
    'ZGFtbg==',
    'ZGFtbmVk',
    'ZGljaw==',
    'ZGlsZG8=',
    'ZHlrZQ==',
    'ZHlrZXM=',
    'ZmFn',
    'ZmFnZ290',
    'ZmFnZ290cw==',
    'ZmFnZ3k=',
    'ZmFncw==',
    'ZmFydA==',
    'ZmFzY2lzdA==',
    'ZnVjaw==',
    'ZnVja2Vy',
    'ZnVja2luZw==',
    'Z29kYW1taXQ=',
    'Z29kZGFtbg==',
    'aGVlYg==',
    'aGVlYnM=',
    'aGl0bGVy',
    'aG9tbw==',
    'aHltaWU=',
    'aHltaWVz',
    'aWRpb3Q=',
    'amFja2Fzcw==',
    'amVyaw==',
    'amVzdXM=',
    'a2lrZQ==',
    'a2lrZXM=',
    'bW9yb24=',
    'bmF6aQ==',
    'bmlnZ2E=',
    'bmlnZ2Vy',
    'cGVkbw==',
    'cGVkb3BoaWxl',
    'cGVuaXM=',
    'cGlzcw==',
    'cG9vZg==',
    'cG9vZnRlcg==',
    'cHJpY2s=',
    'cHVzc3k=',
    'cXVlZXI=',
    'cXVlZXJz',
    'cmFjaXN0',
    'cmFwZXI=',
    'cmFwaXN0',
    'cmV0YXJk',
    'c2F0YW4=',
    'c2hlbWFsZQ==',
    'c2hlbWFsZXM=',
    'c2hpdA==',
    'c2hpdHR5',
    'c2x1dA==',
    'c25vd2ZsYWtl',
    'c3Vja2l0',
    'dHJhbm5pZXM=',
    'dHJhbm55',
    'dHJ1bXA=',
    'dHdhdA==',
    'dmFnaW5h',
    'd2hvcmU=',
    'd29rZQ==',
    'd29rZWlzbQ==',
    'd29rZXN0ZXI=',
    'eWlk',
    'eWlkcw==',
  ]
  // Decoded at load. Kept separate from the "reserved name" list so
  // the validator can give a specific, blunt error for hate
  // speech / profanity vs. a neutral message for role accounts.
  const BAD_WORDS_DECODED = BAD_WORDS.map(b => atob(b))
  const pickPlaceholder = () =>
    PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]

  // Levenshtein distance — classic two-row DP. Fine for short strings
  // (local-parts of email addresses, max ~40 chars) and we only run
  // it on keystrokes inside the sign-in dialog, so perf is a non-issue.
  const levenshtein = (a, b) => {
    if (a === b) {
      return 0
    }
    if (!a) {
      return b.length
    }
    if (!b) {
      return a.length
    }
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    let curr = Array.from({ length: b.length + 1 })
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      }
      // Swap rows instead of copying — O(1) reference swap vs O(n).
      ;[prev, curr] = [curr, prev]
    }
    return prev[b.length]
  }
  // Extract the local-parts (before @) once and lowercase them.
  const PLACEHOLDER_LOCALS = PLACEHOLDERS.map(e =>
    e.split('@')[0].toLowerCase(),
  )
  const RESERVED_STEMS_LC = RESERVED_STEMS_CLEAR.map(s => s.toLowerCase())
  const BOGUS_STEMS_LC = BOGUS_STEMS_CLEAR.map(s => s.toLowerCase())
  const BAD_WORDS_LC = BAD_WORDS_DECODED.map(s => s.toLowerCase())

  // Normalize for comparison: lowercase, strip everything that isn't
  // a letter or digit. "adm1n" → "adm1n"; "a.d.m.i.n" → "admin";
  // "s_0_cket.bot" → "s0cketbot". 1337-speak digits stay so we can
  // catch "adm1n" via the fuzzy path, but separators can't hide a
  // stem behind punctuation.
  const normalizeLocal = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')

  // Is `local` within typo-distance of any entry in `list`? Threshold
  // scales with target length (max 1 + 20%).
  const isNearAny = (local, list) => {
    if (!local) {
      return false
    }
    for (const target of list) {
      if (local === target) {
        return true
      }
      const tolerance = Math.max(1, Math.floor(target.length * 0.2))
      if (levenshtein(local, target) <= tolerance) {
        return true
      }
    }
    return false
  }

  // Does `local` match any stem? Long stems (≥4 chars) use substring
  // match on the normalized form; short stems (≤3) use a word-boundary
  // match on the RAW local-part so "ok" matches `ok.smith` and
  // `smith.ok` but not `brooke`; `hi` matches `hi.jones` but not
  // `chihiro`. Boundary = start/end, or separator char (. _ - +).
  const containsStem = (local, stems) => {
    if (!local) {
      return false
    }
    const lower = local.toLowerCase()
    const norm = normalizeLocal(local)
    for (const stem of stems) {
      if (stem.length >= 4) {
        if (norm.includes(stem)) {
          return true
        }
      } else {
        // Word-boundary test. Build a regex once would be faster but
        // the list is short; a scan is fine.
        const re = new RegExp(`(^|[^a-z0-9])${stem}([^a-z0-9]|$)`, 'i')
        if (re.test(lower)) {
          return true
        }
      }
    }
    return false
  }

  // Gibberish detector — two orthogonal signals, either one trips:
  //
  //   (1) Unique-character ratio < 0.45 on a 4+ char string. Catches
  //       `okokokokok` (2/10 = 0.2) but lets real names through
  //       (`alice` 1.0, `jonathan` 0.75, `anna` 0.5).
  //
  //   (2) Repeated-bigram dominance — if the single most common
  //       bigram occupies ≥ 40% of all bigrams, it's a mash-repeat
  //       like `aasdas` (bigram "as" × 2 of 5 = 0.4), `asdasdasd`
  //       ("sd" × 3 of 8 = 0.375? close call, so we check 40% OR a
  //       string that's just a 2/3-char motif repeated).
  //
  // Rather than two passes, we also bail early if the whole string
  // is a single short motif tiled (e.g. "asdasdasd" → motif "asd"
  // repeats cleanly).
  const looksLikeGibberish = local => {
    if (!local || local.length < 4) {
      return false
    }
    const lower = local.toLowerCase()
    // Signal 1: too few unique chars.
    const chars = new Set(lower)
    if (chars.size / lower.length < 0.45) {
      return true
    }
    // Signal 2: a short motif (2–4 chars) tiles the whole string.
    // `aasdas` isn't a clean tile, but `asdasd`, `okokok`, `abcabc`,
    // `qwerqwer` all are — if lower === motif.repeat(n) for any n ≥ 2,
    // flag it.
    for (let m = 2; m <= 4; m++) {
      if (lower.length % m !== 0 || lower.length / m < 2) {
        continue
      }
      const motif = lower.slice(0, m)
      if (motif.repeat(lower.length / m) === lower) {
        return true
      }
    }
    // Signal 3: one bigram dominates. Catches `aasdas`-style mashes
    // that aren't perfectly tiled. Threshold at ≥ 40% of the
    // (length - 1) bigrams in the string.
    if (lower.length >= 5) {
      const bigrams = new Map()
      for (let i = 0; i < lower.length - 1; i++) {
        const bg = lower.slice(i, i + 2)
        bigrams.set(bg, (bigrams.get(bg) || 0) + 1)
      }
      const max = Math.max(...bigrams.values())
      if (max / (lower.length - 1) >= 0.4) {
        return true
      }
    }
    return false
  }

  const isNearPlaceholder = local =>
    isNearAny(local.toLowerCase(), PLACEHOLDER_LOCALS)
  // Bad words / hate speech — blunt, specific rejection message.
  const containsBadWord = local => containsStem(local, BAD_WORDS_LC)
  // Reserved role / bot / ecosystem addresses — neutral message.
  const isReservedName = local => containsStem(local, RESERVED_STEMS_LC)
  // Joke / placeholder stems — routed through the same "doesn't look
  // real" message as the gibberish detector.
  const isBogusName = local => containsStem(local, BOGUS_STEMS_LC)

  // Single source of truth for email validation — returns an error
  // message (user-facing) or null on success. Called by both the
  // live-input handler (to paint the field + error text) and the
  // submit handler (to stop the POST). Keeps the two in lock-step.
  const SOCKET_SUFFIX = '@socket.dev'
  // Messages return inline HTML (small, static, no user input) so the
  // `@socket.dev` token can render in bold — pulls the eye to the
  // actionable part of the sentence ("use your @socket.dev email")
  // without relying on the user to parse the whole line. Consumers
  // assign via `innerHTML`.
  const SOCKET_BOLD = '<strong>@socket.dev</strong>'
  const validateEmail = value => {
    if (!value) {
      return 'Enter a valid email address.'
    }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(value)) {
      return 'Enter a valid email address.'
    }
    if (!value.endsWith(SOCKET_SUFFIX)) {
      return `Only ${SOCKET_BOLD} email addresses can sign in.`
    }
    const local = value.slice(0, -SOCKET_SUFFIX.length)
    if (isNearPlaceholder(local)) {
      return `Nice try — that looks like one of our placeholders. Use your real ${SOCKET_BOLD} email.`
    }
    if (containsBadWord(local)) {
      return `That one's off-limits. Use your personal ${SOCKET_BOLD} email.`
    }
    if (isReservedName(local)) {
      return `This address is reserved. Use your personal ${SOCKET_BOLD} email.`
    }
    if (isBogusName(local) || looksLikeGibberish(local)) {
      return `That address looks suss. Use your personal ${SOCKET_BOLD} email.`
    }
    return null
  }

  const runAuthFlow = () =>
    new Promise(resolve => {
      const placeholder = pickPlaceholder()
      const { overlay, close } = showModal(`
        <h2 id="wt-modal-title" class="wt-modal-title">Sign in to comment</h2>
        <p class="wt-modal-sub">Enter your <strong>@socket.dev</strong> email to get a 6-digit login code.</p>
        <form class="wt-form" data-step="email">
          <label class="wt-label">Email
            <input type="email" name="email" required autocomplete="username"
              data-1p-ignore data-lpignore="true" data-form-type="other"
              class="wt-input wt-email-input"/>
          </label>
          <button type="submit" class="wt-primary">Send code</button>
          <button type="button" class="wt-secondary wt-cancel">Cancel</button>
          <p class="wt-error" aria-live="polite"></p>
        </form>
      `)
      // Set the placeholder via the DOM API so the fake email never
      // lands in an HTML-interpolated string path (even though the
      // list is ours, this keeps the template free of runtime data).
      overlay
        .querySelector('.wt-email-input')
        ?.setAttribute('placeholder', placeholder)
      const form = overlay.querySelector('.wt-form')
      const errEl = overlay.querySelector('.wt-error')
      // Set prefill via the DOM API, never string interpolation — cheap
      // defense-in-depth against a poisoned localStorage value.
      const emailInput = form.querySelector('input[name="email"]')
      if (state.email) {
        emailInput.value = state.email
      }
      form.querySelector('.wt-cancel')?.addEventListener('click', () => {
        close()
        resolve(false)
      })
      // Live validity + live error text. We only commit to a verdict
      // once the address is structurally complete (ends in the domain).
      // Before that, we stay neutral — no color, no error text —
      // so an incomplete address doesn't flash red mid-typing.
      //
      // Once the address IS complete, `validateEmail` decides in one
      // place whether it's valid and (if not) why. The same function
      // gates the submit handler, so the live message and the submit
      // message can never drift.
      const updateEmailValidity = () => {
        const v = emailInput.value.trim().toLowerCase()
        if (!v.endsWith(SOCKET_SUFFIX)) {
          delete emailInput.dataset.valid
          errEl.innerHTML = ''
          return
        }
        const err = validateEmail(v)
        emailInput.dataset.valid = err ? 'false' : 'true'
        errEl.innerHTML = err || ''
      }
      emailInput.addEventListener('input', updateEmailValidity)
      updateEmailValidity()
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
          <button type="button" class="wt-secondary wt-cancel">Cancel</button>
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
        form.querySelector('.wt-cancel').addEventListener('click', () => {
          close()
          resolve(false)
        })
      }

      form.addEventListener('submit', async e => {
        e.preventDefault()
        errEl.innerHTML = ''
        const data = new FormData(form)
        const step = form.getAttribute('data-step')
        const btn = form.querySelector('button[type=submit]')
        btn.disabled = true
        try {
          if (step === 'email') {
            const email = String(data.get('email') || '')
              .trim()
              .toLowerCase()
            const reason = validateEmail(email)
            if (reason) {
              throw new Error(reason)
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
            errEl2.innerHTML = err.message || String(err)
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
    // 2s cap so a cold-starting val doesn't block the page reveal.
    // AbortSignal.timeout (ES2024) replaces the manual controller +
    // setTimeout dance — self-cancels, self-cleans.
    try {
      const res = await fetch(BACKEND + '/health', {
        signal: AbortSignal.timeout(2000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  /* ─── interaction layer ─────────────────────────────────────────
   * One document-level click handler, dispatched by the nearest
   * [data-action] or role-indicating class. Buttons throughout the
   * render tree declare `data-action="..."` plus any context they
   * need (data-file, data-line, data-id), so render code never
   * attaches listeners directly — it just emits data attributes.
   *
   * One document-level scroll handler (capture phase so nested
   * scroll containers fire too) closes scroll-sensitive UIs.
   *
   * AbortController for per-instance listener cleanup where a
   * single-fire teardown is needed (composer, popover).
   */

  let anchorLine = null

  /* ─── DOM helpers ─────────────────────────────────────────────────
   * Shared lookups around meander's code-table structure. Every file
   * is split across many <table class="code-table" data-file="..."/>
   * blocks, so naive `document.querySelector` only finds the first —
   * the helpers below iterate them all. */

  const codeTables = file =>
    document.querySelectorAll(
      `table.code-table[data-file="${CSS.escape(file)}"]`,
    )

  const lineNumberOf = tr => {
    const text = tr.querySelector('td.line-num')?.textContent.trim()
    const n = Number.parseInt(text || '', 10)
    return Number.isFinite(n) ? n : null
  }

  // Find the <tr> whose line-num === line, scanning every table for
  // the file. Returns null when not found.
  const findRowByLine = (file, line) => {
    for (const table of codeTables(file)) {
      for (const tr of table.querySelectorAll('tr')) {
        if (lineNumberOf(tr) === line) {
          return tr
        }
      }
    }
    return null
  }

  const getLineInfo = el => {
    // Accept clicks anywhere in the row (line-num OR line-code) — a
    // 1px-wide line-num cell was a brutal hit target on rows with
    // short code where the numbered cell collapsed under the text.
    const row = el.closest?.('tr')
    const table = el.closest?.('table.code-table')
    if (!row || !table || row.classList.contains('wt-thread-row')) {
      return null
    }
    const line = lineNumberOf(row)
    if (line === null) {
      return null
    }
    return { file: table.dataset.file || '', line, row, table }
  }

  const clearSelectionUi = () => {
    document
      .querySelectorAll('tr.wt-selected, tr.wt-selected-range')
      .forEach(r => r.classList.remove('wt-selected', 'wt-selected-range'))
    document.querySelector('.wt-selection-popover')?.remove()
    state.selection = null
  }

  const selectRange = (file, fromLine, toLine) => {
    clearSelectionUi()
    const [lo, hi] =
      fromLine <= toLine ? [fromLine, toLine] : [toLine, fromLine]
    for (const table of codeTables(file)) {
      for (const tr of table.querySelectorAll('tr')) {
        const n = lineNumberOf(tr)
        if (n === null || n < lo || n > hi) {
          continue
        }
        tr.classList.add(n === lo ? 'wt-selected' : 'wt-selected-range')
      }
    }
    state.selection = { file, lineFrom: lo, lineTo: hi }
    showSelectionPopover(file, lo, hi)
  }

  const showSelectionPopover = (file, lineFrom, lineTo) => {
    document.querySelector('.wt-selection-popover')?.remove()
    // There's only ever one lo-marker (lo is a single line number),
    // so the first match across all tables for this file is it.
    const firstRow = document.querySelector(
      `table.code-table[data-file="${CSS.escape(file)}"] tr.wt-selected`,
    )
    if (!firstRow) {
      return
    }
    const rowRect = firstRow.getBoundingClientRect()
    const numRect =
      firstRow.querySelector('td.line-num')?.getBoundingClientRect() || rowRect
    const label = `Lines ${lineFrom}${lineTo !== lineFrom ? '–' + lineTo : ''}`

    const pop = document.createElement('div')
    pop.className = 'wt-selection-popover'
    pop.dataset.file = file
    pop.dataset.lineFrom = String(lineFrom)
    pop.dataset.lineTo = String(lineTo)
    pop.innerHTML = `
      <span class="wt-sel-label"></span>
      <button type="button" class="wt-primary" data-action="open-composer">Add comment</button>
      <button type="button" class="wt-secondary" data-action="clear-selection">Cancel</button>
    `
    pop.querySelector('.wt-sel-label').textContent = label
    document.body.appendChild(pop)

    const popHeight = pop.offsetHeight
    const TOPBAR_CLEARANCE = 56
    const top = Math.min(
      window.innerHeight - popHeight - 8,
      Math.max(
        TOPBAR_CLEARANCE + 8,
        rowRect.top + rowRect.height / 2 - popHeight / 2,
      ),
    )
    Object.assign(pop.style, {
      position: 'fixed',
      top: `${top}px`,
      left: `${numRect.right + 8}px`,
    })

    // AbortController ties the scroll listener to this popover
    // instance — calling ctrl.abort() in the action handler cleans
    // up without manual removeEventListener bookkeeping.
    const ctrl = new AbortController()
    pop.dataset.abortCtrl = '' // marker for delegation code
    pop._ctrl = ctrl
    document.addEventListener(
      'scroll',
      () => {
        pop.remove()
        ctrl.abort()
      },
      { capture: true, passive: true, signal: ctrl.signal },
    )
  }

  // Single click delegate for everything the shim owns. Each
  // button/element emits data-action="..."; we switch on that.
  // Clicks that don't map to an action fall through to the
  // line-number / outside-selection-clear logic.
  document.addEventListener('click', async e => {
    const actionEl = e.target.closest?.('[data-action]')
    const action = actionEl?.dataset.action

    switch (action) {
      case 'open-composer': {
        if (!(await ensureAuth())) {
          return
        }
        const pop = actionEl.closest('.wt-selection-popover')
        const file = pop?.dataset.file || ''
        const lineFrom = Number(pop?.dataset.lineFrom)
        const lineTo = Number(pop?.dataset.lineTo)
        pop?._ctrl?.abort()
        pop?.remove()
        showCommentForm(file, lineFrom, lineTo, null)
        return
      }
      case 'clear-selection': {
        clearSelectionUi()
        return
      }
      case 'reply': {
        if (!(await ensureAuth())) {
          return
        }
        const { file, lineFrom, lineTo, parentId } = actionEl.dataset
        showCommentForm(
          file,
          Number(lineFrom),
          Number(lineTo),
          parentId || null,
        )
        return
      }
      case 'toggle-thread': {
        const key = actionEl.dataset.key
        if (state.expandedGroups.has(key)) {
          state.expandedGroups.delete(key)
        } else {
          state.expandedGroups.add(key)
        }
        renderAll()
        return
      }
      case 'resolve': {
        const id = actionEl.dataset.id
        const next = actionEl.dataset.resolved !== 'true'
        try {
          await apiJson(`/${slug}/api/comments/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ resolved: next }),
          })
          const c = state.comments.find(x => x.id === id)
          if (c) {
            c.resolved = next
          }
          renderAll()
          refreshUnresolvedCount()
        } catch {
          /* TODO surface a toast */
        }
        return
      }
      case 'delete-comment': {
        const id = actionEl.dataset.id
        if (!confirm('Delete this comment?')) {
          return
        }
        try {
          await apiJson(`/${slug}/api/comments/${id}`, { method: 'DELETE' })
          state.comments = state.comments.filter(x => x.id !== id)
          renderAll()
          refreshUnresolvedCount()
        } catch {
          /* ignore */
        }
        return
      }
    }

    // No action matched — handle raw line clicks + outside-selection clear.
    if (e.target.closest?.('.wt-selection-popover')) {
      return
    }
    // Entire <tr> in a code-table is a click target. Ignore clicks on
    // injected thread rows (they have their own action handlers).
    const codeRow = e.target.closest?.('table.code-table tr')
    if (codeRow && !codeRow.classList.contains('wt-thread-row')) {
      const info = getLineInfo(e.target)
      if (!info) {
        return
      }
      if (e.shiftKey && anchorLine && anchorLine.file === info.file) {
        selectRange(info.file, anchorLine.line, info.line)
      } else {
        anchorLine = { file: info.file, line: info.line }
        selectRange(info.file, info.line, info.line)
      }
      return
    }
    if (
      state.selection &&
      !e.target.closest?.('.wt-comment-form') &&
      !e.target.closest?.('table.code-table') &&
      !e.target.closest?.('.wt-thread-row')
    ) {
      clearSelectionUi()
    }
  })

  /* ─── comment form ────────────────────────────────────────────── */

  const showCommentForm = (file, lineFrom, lineTo, parentId) => {
    // Close any open composer first. We use a native <dialog> so focus
    // is trapped inside the form while typing (can't Tab out), Escape
    // cancels cleanly, and the top-layer guarantees we stack above
    // comment threads and the splitter without z-index math. The
    // dialog is positioned next to the selected lines rather than
    // centered, and its ::backdrop is transparent — the user keeps
    // the code visible while writing.
    document.querySelector('.wt-comment-form')?.remove()

    const dialog = document.createElement('dialog')
    dialog.className = 'wt-comment-form'
    const form = document.createElement('form')
    form.method = 'dialog'
    form.innerHTML = `
      <div class="wt-comment-header">
        <strong>${esc(file)}</strong>
        <span>Lines ${lineFrom}${lineTo !== lineFrom ? '–' + lineTo : ''}</span>
      </div>
      <textarea class="wt-input wt-textarea" placeholder="Write a comment…" required maxlength="10000"></textarea>
      <div class="wt-row">
        <button type="submit" class="wt-primary wt-post">Post</button>
        <button type="button" class="wt-secondary wt-cancel">Cancel</button>
      </div>
      <p class="wt-error" aria-live="polite"></p>
    `
    dialog.appendChild(form)
    document.body.appendChild(dialog)

    const close = () => {
      if (dialog.open) {
        dialog.close()
      }
      dialog.remove()
    }
    dialog.addEventListener('close', () => dialog.remove())

    // Outside-click dismisses. Because the dialog is in the top layer,
    // clicks on the backdrop surface as clicks whose target IS the
    // dialog (not a descendant). Without this, the composer blocks
    // all clicks on the underlying page until submit/cancel — which
    // is why "I can't click line numbers" happens.
    dialog.addEventListener('click', e => {
      if (e.target === dialog) {
        close()
      }
    })

    // Close on significant scroll — the dialog is positioned relative
    // to the anchor row's viewport coords, so scroll breaks alignment.
    // Capture on document so internal scroll containers (.right-pane
    // etc.) also fire the handler, since scroll events don't bubble.
    // Small accidental scrolls (trackpad jitter) are tolerated; >30px
    // cumulative closes. Keeps an in-progress draft from vanishing
    // on a hair-trigger.
    const initialWindowY = window.scrollY
    const scrollContainers = document.querySelectorAll(
      '.right-pane, .left-pane',
    )
    const initialContainerY = new Map()
    for (const el of scrollContainers) {
      initialContainerY.set(el, el.scrollTop)
    }
    const onScroll = () => {
      if (Math.abs(window.scrollY - initialWindowY) > 30) {
        return closeAndUnbind()
      }
      for (const [el, y0] of initialContainerY) {
        if (Math.abs(el.scrollTop - y0) > 30) {
          return closeAndUnbind()
        }
      }
    }
    const closeAndUnbind = () => {
      close()
      document.removeEventListener('scroll', onScroll, true)
    }
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    })

    // showModal() first so the dialog lays out and we can measure
    // its real height. Then anchor to the selected row, flipping
    // above when below would clip past the viewport bottom.
    dialog.showModal()

    const anchorRow = document.querySelector(
      `table.code-table[data-file="${CSS.escape(file)}"] tr.wt-selected`,
    )
    const anchorRect = anchorRow?.getBoundingClientRect()
    if (anchorRect) {
      const GAP = 6
      const dialogHeight = dialog.offsetHeight
      const fitsBelow =
        anchorRect.bottom + GAP + dialogHeight <= window.innerHeight
      const top = fitsBelow
        ? window.scrollY + anchorRect.bottom + GAP
        : window.scrollY + anchorRect.top - GAP - dialogHeight
      Object.assign(dialog.style, {
        margin: '0',
        top: `${Math.max(window.scrollY + 8, top)}px`,
        left: `${window.scrollX + anchorRect.left}px`,
      })
    }

    form.querySelector('textarea').focus()
    form.querySelector('.wt-cancel').addEventListener('click', close)
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
        close()
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
    // Wipe everything we previously rendered. Thread rows live inside
    // tbody as <tr>, indicators in line-num cells.
    document
      .querySelectorAll('tr.wt-thread-row, .wt-indicator')
      .forEach(el => el.remove())

    // Group comments by file:lineFrom. Object.groupBy (ES2024) is
    // slightly nicer than the manual Map build, but it returns an
    // object keyed by string; Map still fits our iteration better.
    const groups = Map.groupBy(state.comments, c => `${c.file}:${c.lineFrom}`)

    for (const [key, group] of groups) {
      const [file, lineFromStr] = key.split(':')
      const lineFrom = Number.parseInt(lineFromStr, 10)
      const anchorRow = findRowByLine(file, lineFrom)
      if (!anchorRow) {
        continue
      }

      // Indicator dot — click delegation picks up data-action="toggle-thread".
      const numCell = anchorRow.querySelector('td.line-num')
      if (numCell && !numCell.querySelector('.wt-indicator')) {
        const dot = document.createElement('span')
        dot.className = 'wt-indicator'
        dot.dataset.action = 'toggle-thread'
        dot.dataset.key = key
        const hasOpen = group.some(c => !c.parentId && !c.resolved)
        dot.classList.toggle('wt-indicator-open', hasOpen)
        dot.title = `${group.length} comment${group.length === 1 ? '' : 's'}`
        numCell.appendChild(dot)
      }

      if (!state.expandedGroups.has(key)) {
        continue
      }

      // thread card
      const roots = group.filter(c => !c.parentId)
      const byParent = Map.groupBy(
        group.filter(c => c.parentId),
        c => c.parentId,
      )
      for (const root of roots) {
        // Thread lives in a full-width <tr> so the DOM stays valid
        // table structure — inserting a plain <div> into <tbody>
        // causes the browser to auto-reparent it, which was breaking
        // subsequent line-click handling.
        const threadRow = document.createElement('tr')
        threadRow.className = 'wt-thread-row'
        const cell = document.createElement('td')
        cell.colSpan = 2
        cell.className = 'wt-thread-cell'
        const card = document.createElement('div')
        card.className = 'wt-thread'
        card.appendChild(renderCommentCard(root, false))
        for (const reply of byParent.get(root.id) || []) {
          card.appendChild(renderCommentCard(reply, true))
        }
        const replyBtn = document.createElement('button')
        replyBtn.type = 'button'
        replyBtn.className = 'wt-secondary wt-reply-btn'
        replyBtn.dataset.action = 'reply'
        replyBtn.dataset.file = root.file
        replyBtn.dataset.lineFrom = String(root.lineFrom)
        replyBtn.dataset.lineTo = String(root.lineTo)
        replyBtn.dataset.parentId = root.id
        replyBtn.textContent = 'Reply'
        card.appendChild(replyBtn)
        cell.appendChild(card)
        threadRow.appendChild(cell)
        anchorRow.parentNode.insertBefore(threadRow, anchorRow.nextSibling)
      }
    }
  }

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
      resolveBtn.className = 'wt-secondary'
      resolveBtn.dataset.action = 'resolve'
      resolveBtn.dataset.id = c.id
      resolveBtn.dataset.resolved = String(!!c.resolved)
      resolveBtn.textContent = c.resolved ? 'Unresolve' : 'Resolve'
      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.className = 'wt-danger'
      deleteBtn.dataset.action = 'delete-comment'
      deleteBtn.dataset.id = c.id
      deleteBtn.textContent = 'Delete'
      actions.append(resolveBtn, deleteBtn)
      el.append(actions)
    }
    return el
  }

  /* ─── unresolved + export ─────────────────────────────────────── */

  // Close `el` when a click lands outside it. Uses AbortController so
  // caller just calls the returned teardown if it wants to end early;
  // otherwise the listener self-removes the first time it fires on
  // an outside click. The setTimeout(0) defers binding to the next
  // tick so the click that opened `el` doesn't immediately close it.
  const bindOutsideDismiss = el => {
    const ctrl = new AbortController()
    setTimeout(() => {
      document.addEventListener(
        'click',
        e => {
          if (!el.contains(e.target)) {
            el.remove()
            ctrl.abort()
          }
        },
        { signal: ctrl.signal },
      )
    }, 0)
    return () => ctrl.abort()
  }

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

    // Account header — shows signed-in email + sign-out button. Placed
    // at the top of the dropdown so sign-out is always reachable from
    // the same affordance users opened to find their comments.
    const header = document.createElement('div')
    header.className = 'wt-dropdown-header'
    const who = document.createElement('span')
    who.className = 'wt-dropdown-who'
    who.textContent = state.email || 'signed in'
    const signOut = document.createElement('button')
    signOut.type = 'button'
    signOut.className = 'wt-dropdown-signout'
    signOut.textContent = 'Sign out'
    signOut.addEventListener('click', async e => {
      e.stopPropagation()
      signOut.disabled = true
      try {
        // POST /auth/logout revokes the server-side jti so even a
        // captured JWT can't be re-used. If it fails (network blip,
        // 401 from a bad token), we still clear localStorage so the
        // client is signed out locally.
        await fetch(BACKEND + '/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${state.jwt}` },
        })
      } catch {
        /* ignore — the localStorage clear below is the real signout */
      }
      saveJwt(null, null)
      dd.remove()
      location.reload()
    })
    header.append(who, signOut)
    dd.appendChild(header)

    const body = document.createElement('div')
    body.className = 'wt-dropdown-body'
    body.innerHTML =
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
    dd.appendChild(body)

    document.body.appendChild(dd)
    positionDropdown(dd, '.wt-unresolved-btn')
    for (const a of dd.querySelectorAll('.wt-dropdown-item')) {
      a.addEventListener('click', e => {
        e.preventDefault()
        const file = a.getAttribute('data-file')
        const line = Number.parseInt(a.getAttribute('data-line'), 10)
        findRowByLine(file, line)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
        state.expandedGroups.add(`${file}:${line}`)
        renderAll()
        dd.remove()
      })
    }
    bindOutsideDismiss(dd)
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
    bindOutsideDismiss(dd)
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
    // Icon path pre-optimized via svgo — closing Z on the vertical
    // stroke is implicit (move-to closes the subpath automatically).
    exportBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 11.5a.5.5 0 0 1-.5-.5V2.707L5.854 4.354a.5.5 0 1 1-.708-.708l2.5-2.5a.5.5 0 0 1 .708 0l2.5 2.5a.5.5 0 0 1-.708.708L8.5 2.707V11a.5.5 0 0 1-.5.5M2 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4a.5.5 0 0 0-1 0v4H3v-4a.5.5 0 0 0-1 0z"/></svg>`
    exportBtn.addEventListener('click', async () => {
      if (!(await ensureAuth())) {
        return
      }
      showExportDropdown()
    })
    host.appendChild(exportBtn)

    // Comments button — two visual states:
    //   - signed out: empty outline speech bubble (inviting, non-committal)
    //   - signed in:  outline bubble with three dots ("open to see threads")
    // Single SVG; the .wt-bubble-dots group is hidden by default and
    // shown when the wrapper has data-signed-in="true". CSS handles
    // the flip — keeps state sync with auth cheap (one attribute).
    const unresolvedBtn = document.createElement('button')
    unresolvedBtn.type = 'button'
    unresolvedBtn.className = 'wt-unresolved-btn'
    unresolvedBtn.setAttribute('aria-label', 'Comments')
    unresolvedBtn.title = 'Comments'
    // 18×18 (up from 16) with the dots spread to cx 7/12/17 — leaves
    // more breathing room inside the bubble and makes the hit target
    // meatier in the topbar row.
    // Fill/stroke hoisted to the <g> parent so each circle is attr-free
    // (svgo "collapseGroups"). Saves bytes and keeps the dots visually
    // identical — CSS reads the class names for the drop-in animation.
    unresolvedBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        <g class="wt-bubble-dots" fill="currentColor" stroke="none">
          <circle class="wt-dot wt-dot-1" cx="7"  cy="10" r="1.15"/>
          <circle class="wt-dot wt-dot-2" cx="12" cy="10" r="1.15"/>
          <circle class="wt-dot wt-dot-3" cx="17" cy="10" r="1.15"/>
        </g>
      </svg>
      <span class="wt-unresolved-badge"></span>
    `
    // Keep the signed-in flag on the button itself — CSS reads it via
    // attribute selector to toggle the dots. We refresh it whenever
    // auth state changes (silent check, sign-in, sign-out).
    let lastSignedIn = !!state.jwt
    const reflectAuthState = () => {
      const signedIn = !!state.jwt
      unresolvedBtn.dataset.signedIn = signedIn ? 'true' : 'false'
      // Play the staggered 1→2→3 drop-in animation only on the
      // signed-out → signed-in transition (fresh login). Remove the
      // class first so re-triggering on repeat logins actually
      // restarts the animation (CSS animations don't replay on a
      // stable class name).
      if (signedIn && !lastSignedIn) {
        unresolvedBtn.classList.remove('wt-dots-drop')
        // Force reflow so the animation re-runs.
        // eslint-disable-next-line no-unused-expressions
        unresolvedBtn.offsetWidth
        unresolvedBtn.classList.add('wt-dots-drop')
      }
      lastSignedIn = signedIn
    }
    reflectAuthState()
    // Observe state.jwt mutations: rather than a proxy, we hook the
    // existing saveJwt/loadJwt sites by exposing a refresh function.
    state.__refreshAuthUi = reflectAuthState
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
      const first = document.querySelector('.line-code code')
      if (!first || first.classList.contains('hljs')) {
        resolve()
        return
      }
      const obs = new MutationObserver(() => {
        if (first.classList.contains('hljs')) {
          obs.disconnect()
          resolve()
        }
      })
      obs.observe(first, { attributes: true, attributeFilter: ['class'] })
      AbortSignal.timeout(1500).addEventListener('abort', () => {
        obs.disconnect()
        resolve()
      })
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
