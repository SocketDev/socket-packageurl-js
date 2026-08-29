#!/usr/bin/env node
/*
 * @file Build the npm mockup pages a walkthrough recording films, and add new
 *   npm screens by composing them rather than cloning HTML.
 *
 *     node .claude/skills/fleet/recording-ui-walkthroughs/npm-mockup.mts \
 *       [--out-dir <dir>] [--check]
 *
 *   Why mockups rather than the real site: recording npmjs.com means signing in
 *   to a live account and minting a real credential to film, and every frame
 *   carries that account's identity — the account name sits in the URL and the
 *   sidebar lists every organization the account belongs to. Nothing built here
 *   talks to npm and no token exists; the account name is a placeholder the
 *   recorder rewrites, and the organizations are invented.
 *
 *   Why a generator: the next npm screen worth showing should inherit the
 *   chrome — the rainbow rule, the wordmark, the wombat, the sidebar, the
 *   select menus — instead of being cloned from this one and drifting. Add a
 *   page to NPM_MOCKUP_PAGES, compose its content from the field helpers, and
 *   the shell comes with it. `--check` fails when a written page no longer
 *   matches the generator, so a committed copy cannot quietly diverge.
 *
 *   Fidelity: follow npm's real page closely enough that written steps are
 *   recognizable when a customer gets there. The point is which controls matter
 *   (Read only, No access, an expiry, 2FA left alone), not pixel fidelity.
 *
 *   npm's wordmark and their wombat are drawn inline rather than shipped as
 *   files or hotlinked, so a recording works offline and no third-party binary
 *   lands in the repo. They identify whose screen this is, which is the point of
 *   showing it: we are pointing customers at npm and telling them how to use it.
 *
 *   Exit codes: 0 — pages written (or current, with --check); 1 — stale pages.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

/**
 * Id of the account name in the URL bar, rewritten by the recorder.
 */
export const NPM_ACCOUNT_ID = 'npm-account'

/**
 * Npm's published wordmark.
 */
export const NPM_WORDMARK_SVG = `<svg class="wordmark" viewBox="0 0 780 250" role="img" aria-label="npm">
        <path
          fill="#231F20"
          d="M240,250h100v-50h100V0H240V250z M340,50h50v100h-50V50z M480,0v200h100V50h50v150h50V50h50v150h50V0H480z M0,200h100V50h50v150h50V0H0V200z"
        />
      </svg>`

/**
 * Npm's signed-in avatar is their wombat, drawn the way it reads at 32px: ears,
 * eyes, a light muzzle, and the broad nose that makes it a wombat rather than
 * a bear.
 */
export const NPM_WOMBAT_AVATAR_SVG = `<svg class="avatar" viewBox="0 0 64 64" role="img" aria-label="Account">
        <circle cx="32" cy="32" r="32" fill="#e2e2e2" />
        <circle cx="19" cy="19" r="7" fill="#6f5335" />
        <circle cx="45" cy="19" r="7" fill="#6f5335" />
        <circle cx="19" cy="19" r="3.4" fill="#9c7a56" />
        <circle cx="45" cy="19" r="3.4" fill="#9c7a56" />
        <ellipse cx="32" cy="34" rx="17" ry="18" fill="#8b6746" />
        <ellipse cx="32" cy="42" rx="11.5" ry="9.5" fill="#a9865f" />
        <circle cx="24.5" cy="30" r="2.7" fill="#1b1b1b" />
        <circle cx="39.5" cy="30" r="2.7" fill="#1b1b1b" />
        <circle cx="25.4" cy="29.2" r="0.9" fill="#ffffff" />
        <circle cx="40.4" cy="29.2" r="0.9" fill="#ffffff" />
        <ellipse cx="32" cy="39.5" rx="6.4" ry="4.6" fill="#241a12" />
        <path
          d="M32 44v3"
          fill="none"
          stroke="#241a12"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <path
          d="M27 48c1.6 1.6 3.4 1.6 5 0c1.6 1.6 3.4 1.6 5 0"
          fill="none"
          stroke="#241a12"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>`

/**
 * The mockup's stylesheet: npm's type, spacing, and control shapes.
 */
export const NPM_MOCKUP_CSS = `      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font:
          15px/1.5 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto,
          Helvetica, Arial, sans-serif;
        color: #231f20;
        background: #fff;
      }
      /* Browser chrome: npm puts the account name in the URL. */
      .chrome {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 12px;
        background: #f1f3f4;
        border-bottom: 1px solid #dadce0;
        font-size: 13px;
      }
      .urlbar {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        background: #fff;
        border: 1px solid #dadce0;
        border-radius: 999px;
        padding: 5px 12px;
      }
      .illustration {
        padding: 2px 9px;
        border: 1px solid #cbcbcb;
        border-radius: 999px;
        font-size: 11px;
        color: #6a6a6a;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex: none;
      }
      .rainbow {
        height: 5px;
        background: linear-gradient(90deg, #fb8817, #ff4b01, #c12127, #e02aff);
      }
      .topnav {
        display: flex;
        align-items: center;
        gap: 26px;
        padding: 13px 22px;
        border-bottom: 1px solid #e6e6e6;
        font-weight: 600;
        font-size: 14px;
      }
      .searchrow {
        display: flex;
        align-items: center;
        gap: 18px;
        padding: 14px 22px;
        border-bottom: 1px solid #e6e6e6;
      }
      .wordmark {
        display: block;
        width: 62px;
        height: 20px;
        flex: none;
      }
      .search {
        flex: 1;
        display: flex;
      }
      .search input {
        flex: 1;
        border: 0;
        background: #f2f2f2;
        padding: 11px 14px;
        font: inherit;
        color: #6a6a6a;
      }
      .search .go {
        background: #000;
        color: #fff;
        font-weight: 700;
        padding: 11px 24px;
      }
      .avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        flex: none;
        display: block;
      }
      .body {
        display: flex;
        align-items: flex-start;
      }
      .sidebar {
        width: 230px;
        flex: none;
        padding: 18px;
        border-right: 1px solid #e6e6e6;
      }
      .sidebar ul {
        list-style: none;
        margin: 0 0 20px;
        padding: 0;
      }
      .sidebar li {
        padding: 6px 0;
        font-weight: 600;
      }
      .sidebar h3 {
        font-size: 18px;
        font-weight: 400;
        color: rgba(35, 31, 32, 0.7);
        margin: 0 0 6px;
      }
      main {
        flex: 1;
        padding: 22px 30px 40px;
        min-width: 0;
      }
      .titlerow {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 20px;
        margin-bottom: 6px;
      }
      h1 {
        font-size: 26px;
        margin: 0;
      }
      a {
        color: #231f20;
      }
      .lede {
        margin: 6px 0 22px;
      }
      h2.section {
        font-size: 21px;
        font-weight: 600;
        margin: 26px 0 0;
      }
      .rule {
        border-bottom: 1px solid #e6e6e6;
        margin: 8px 0 14px;
      }
      .fieldlabel {
        display: block;
        font-weight: 600;
        font-size: 15px;
      }
      .hint {
        color: #545454;
        font-size: 13px;
        margin: 1px 0 7px;
      }
      input[type='text'] {
        display: block;
        width: 430px;
        max-width: 100%;
        padding: 8px 10px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 3px;
        font: inherit;
        color: rgba(0, 0, 0, 0.7);
      }
      textarea {
        display: block;
        width: 620px;
        max-width: 100%;
        height: 74px;
        padding: 8px 10px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 3px;
        font: inherit;
      }
      .checkline {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin: 14px 0 4px;
      }
      .mb {
        margin-bottom: 16px;
      }
      /* npm's select menus: a summary that opens a small floating list. */
      details {
        display: inline-block;
        position: relative;
      }
      summary {
        list-style: none;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border: 1px solid rgba(27, 31, 35, 0.15);
        border-radius: 6px;
        background: #fafbfc;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
      }
      summary::-webkit-details-marker {
        display: none;
      }
      .caret {
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 5px solid #666;
      }
      .menu {
        position: absolute;
        z-index: 5;
        top: calc(100% + 4px);
        left: 0;
        width: 300px;
        background: #fff;
        border: 1px solid rgba(27, 31, 35, 0.15);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(28, 32, 40, 0.2);
        padding: 4px 0;
      }
      .menu button {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 12px;
        border: 0;
        background: none;
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
      }
      .menu button:hover {
        background: #0366d6;
        color: #fff;
      }
      .tick {
        width: 14px;
        color: #24292e;
      }
      .menu button[aria-checked='false'] .tick {
        visibility: hidden;
      }
      .summarybox {
        font-size: 13px;
      }
      .summarybox ul {
        margin: 6px 0 0;
        padding-left: 20px;
      }
      .strong {
        font-weight: 700;
      }
      .actions {
        margin-top: 22px;
        display: flex;
        gap: 10px;
      }
      .actions button {
        padding: 7px 16px;
        border: 1px solid rgba(27, 31, 35, 0.15);
        border-radius: 6px;
        background: #fafbfc;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
      }`

/**
 * Keeps a select menu honest: choosing an option closes the menu, moves the
 * tick, and restates the choice in the summary — the behaviour that makes a
 * recording read as a real screen rather than a still.
 */
export const NPM_SELECT_MENU_SCRIPT = `      // The tick lives inside the button, so read the label from the text after
      // it rather than the button's whole textContent.
      for (const button of document.querySelectorAll('[data-pick]')) {
        button.addEventListener('click', () => {
          const group = button.dataset.pick
          const label = button.lastChild.textContent.trim()
          for (const sibling of button.parentElement.children) {
            sibling.setAttribute('aria-checked', String(sibling === button))
          }
          document.getElementById(\`\${group}-value\`).textContent = label
          document.getElementById(\`\${group}-menu\`).open = false
          const summary = document.getElementById(\`sum-\${group}\`)
          if (!summary) {
            return
          }
          if (group === 'exp') {
            summary.textContent = label
          } else {
            summary.textContent = label === 'No access' ? 'no' : 'read'
          }
        })
      }`

export interface NpmMockupPage {
  /**
   * Path of the account page, after npmjs.com/settings/<account>/.
   */
  accountPath: string
  /**
   * Link shown opposite the title.
   */
  docsLink?: string | undefined
  /**
   * Sentence under the title; may contain markup.
   */
  lede?: string | undefined
  /**
   * The page body, composed from the helpers below.
   */
  main: string
  /**
   * Organizations listed in the sidebar. Invented, never a real account's.
   */
  organizations?: readonly string[] | undefined
  /**
   * Page script; defaults to the select-menu behaviour.
   */
  script?: string | undefined
  /**
   * Settings links in the sidebar.
   */
  sidebar?: readonly string[] | undefined
  title: string
}

const DEFAULT_SIDEBAR: readonly string[] = [
  'Profile',
  'Packages',
  'Account',
  'Billing Info',
  'Access Tokens',
  'Staged Packages',
]

const DEFAULT_ORGANIZATIONS: readonly string[] = [
  'your-org',
  'your-org-registry',
]

/**
 * A section heading with npm's rule under it.
 */
export function npmSection(title: string): string {
  return `        <h2 class="section">${title}</h2>
        <div class="rule"></div>`
}

/**
 * A labelled single-line field.
 */
export function npmTextField(config: {
  hint: string
  id: string
  label: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  return `        <div class="mb">
          <label class="fieldlabel" for="${cfg.id}">${cfg.label}</label>
          <p class="hint">${cfg.hint}</p>
          <input id="${cfg.id}" type="text" />
        </div>`
}

/**
 * A labelled multi-line field.
 */
export function npmTextArea(config: {
  hint: string
  id: string
  label: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  return `        <div class="mb">
          <label class="fieldlabel" for="${cfg.id}">
            ${cfg.label}
          </label>
          <p class="hint">${cfg.hint}</p>
          <textarea id="${cfg.id}"></textarea>
        </div>`
}

/**
 * A checkbox with its label beside it and a hint below.
 */
export function npmCheckbox(config: {
  hint: string
  id: string
  label: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  return `        <div class="checkline">
          <input type="checkbox" id="${cfg.id}" />
          <label for="${cfg.id}">${cfg.label}</label>
        </div>
        <p class="hint">${cfg.hint}</p>`
}

export interface NpmSelectOption {
  /**
   * Id for the recorder to click; omit for options a walkthrough never picks.
   */
  id?: string | undefined
  label: string
  selected?: boolean | undefined
}

/**
 * One of npm's select menus. `group` drives the element ids, so a walkthrough
 * clicks `#<group>-summary` to open it and an option's own id to pick it.
 */
export function npmSelectMenu(config: {
  group: string
  options: readonly NpmSelectOption[]
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const selected = cfg.options.find(option => option.selected) ?? cfg.options[0]
  const items = cfg.options
    .map(option => {
      const id = option.id ? `\n              id="${option.id}"` : ''
      return `            <button
              type="button"
              aria-checked="${String(option === selected)}"
              data-pick="${cfg.group}"${id}
            >
              <span class="tick">&#10003;</span>${option.label}
            </button>`
    })
    .join('\n')
  return `        <details id="${cfg.group}-menu">
          <summary id="${cfg.group}-summary">
            <span id="${cfg.group}-value">${selected?.label ?? ''}</span
            ><span class="caret"></span>
          </summary>
          <div class="menu" role="menu">
${items}
          </div>
        </details>`
}

/**
 * A bold field label with no control of its own.
 */
export function npmFieldLabel(label: string): string {
  return `        <p class="fieldlabel">${label}</p>`
}

/**
 * A hint paragraph.
 */
export function npmHint(hint: string): string {
  return `        <p class="hint">${hint}</p>`
}

/**
 * The buttons that close the form. The first is the one a walkthrough clicks.
 */
export function npmActions(
  buttons: ReadonlyArray<{ id?: string | undefined; label: string }>,
): string {
  const items = buttons
    .map(button => {
      const id = button.id ? ` id="${button.id}"` : ''
      return `          <button type="button"${id}>${button.label}</button>`
    })
    .join('\n')
  return `        <div class="actions">
${items}
        </div>`
}

/**
 * Wraps page content in npm's browser chrome, header, and sidebar.
 */
export function renderNpmMockup(page: NpmMockupPage): string {
  const sidebar = (page.sidebar ?? DEFAULT_SIDEBAR)
    .map(item => `          <li>${item}</li>`)
    .join('\n')
  const organizations = (page.organizations ?? DEFAULT_ORGANIZATIONS)
    .map(item => `          <li>${item}</li>`)
    .join('\n')
  const docsLink = page.docsLink
    ? `\n          <a href="#">${page.docsLink}</a>`
    : ''
  const lede = page.lede ? `\n        <p class="lede">${page.lede}</p>` : ''
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>npm — ${page.title} (illustration)</title>
    <!--
      Generated by the fleet skill recording-ui-walkthroughs (npm-mockup.mts).
      Do not edit: change the generator and re-run it. That file explains why
      this is a mockup and what has to stay faithful to npm.
    -->
    <style>
${NPM_MOCKUP_CSS}
    </style>
  </head>
  <body>
    <div class="chrome">
      <span>&#8592; &#8594;</span>
      <span class="urlbar">
        <span>&#128274;</span>
        <span
          >npmjs.com/settings/<span id="${NPM_ACCOUNT_ID}">account-name</span
          >/${page.accountPath}</span
        >
      </span>
      <span class="illustration">Illustration</span>
    </div>
    <div class="rainbow"></div>

    <nav class="topnav">
      <span aria-hidden="true">&#9789;</span>
      <span>Pro</span><span>Teams</span><span>Pricing</span
      ><span>Documentation</span>
    </nav>

    <div class="searchrow">
      ${NPM_WORDMARK_SVG}
      <span class="search">
        <input placeholder="Search packages" />
        <span class="go">Search</span>
      </span>
      ${NPM_WOMBAT_AVATAR_SVG}
    </div>

    <div class="body">
      <aside class="sidebar">
        <ul>
${sidebar}
        </ul>
        <h3>Organizations</h3>
        <ul class="orgs">
${organizations}
        </ul>
      </aside>

      <main>
        <div class="titlerow">
          <h1>${page.title}</h1>${docsLink}
        </div>${lede}

${page.main}
      </main>
    </div>

    <script>
${page.script ?? NPM_SELECT_MENU_SCRIPT}
    </script>
  </body>
</html>
`
}

/**
 * Npm's New Granular Access Token screen.
 */
export function renderGranularAccessTokenPage(): string {
  const sections = [
    npmSection('General'),
    npmTextField({
      hint: 'Provide a unique name.',
      id: 'token-name',
      label: 'Token name *',
    }),
    npmTextArea({
      hint: 'What is this token for?',
      id: 'description',
      label: 'Description (optional)',
    }),
    npmCheckbox({
      hint: 'Leave unchecked; reads never trip 2FA.',
      id: 'bypass',
      label: 'Bypass two-factor authentication (2FA)',
    }),
    npmTextField({
      hint: 'Must be valid <a href="#">CIDR notation</a>. Leave empty.',
      id: 'ips',
      label: 'Allowed IP ranges (optional)',
    }),
    npmSection('Packages and scopes'),
    npmFieldLabel('Permissions'),
    npmSelectMenu({
      group: 'pkg',
      options: [
        { label: 'No access', selected: true },
        { id: 'pkg-read', label: 'Read only' },
        { label: 'Read and write' },
      ],
    }),
    npmHint(
      'Socket only reads staged tarballs, so Read only is enough — a\n          write-capable token is rejected when you save it.',
    ),
    npmSection('Organizations'),
    npmFieldLabel('Permissions'),
    npmSelectMenu({
      group: 'org',
      options: [
        { id: 'org-none', label: 'No access', selected: true },
        { label: 'Read only' },
      ],
    }),
    npmHint('Organization access is not needed.'),
    npmSection('Expiration'),
    npmFieldLabel('Expiration Date'),
    npmSelectMenu({
      group: 'exp',
      options: [
        { label: '7 days' },
        { label: '30 days', selected: true },
        { label: '60 days' },
        { id: 'exp-90', label: '90 days' },
      ],
    }),
    npmSection('Summary'),
    `        <div class="summarybox">
          <p>This token will:</p>
          <ul>
            <li>
              Provide <span class="strong" id="sum-pkg">no</span> access to
              packages and scopes
            </li>
            <li>
              Provide <span class="strong" id="sum-org">no</span> access to
              organizations
            </li>
            <li>Expires in <span class="strong" id="sum-exp">30 days</span></li>
          </ul>
        </div>`,
    npmActions([
      { id: 'generate', label: 'Generate token' },
      { label: 'Cancel' },
    ]),
  ].join('\n\n')
  return renderNpmMockup({
    accountPath: 'tokens/granular-access-tokens/new',
    docsLink: 'View token documentation',
    lede: `
          <a href="#">Granular access tokens</a> provide the most control by
          allowing you to configure fine-grained, tightly scoped permissions
          for your packages and organizations.
        `,
    main: sections,
    title: 'New Granular Access Token',
  })
}

/**
 * Every mockup this generator owns. Add a page here to have it written.
 */
export const NPM_MOCKUP_PAGES: ReadonlyArray<{
  file: string
  render: () => string
}> = [
  { file: 'npm-granular-token.html', render: renderGranularAccessTokenPage },
]

/**
 * Default output directory: a mockups/ folder beside the caller's cwd.
 */
export const DEFAULT_NPM_MOCKUP_DIR = path.join(process.cwd(), 'mockups')

function main(): number {
  const argv = process.argv.slice(2)
  const description =
    'generates the npm mockup pages a walkthrough recording films'
  if (argv.includes('--help') || argv.includes('-h')) {
    logger.info(
      'Usage: npm-mockup.mts [--out-dir <dir>] [--check] | --describe [--json]',
    )
    logger.error('')
    return 0
  }
  if (argv.includes('--describe')) {
    logger.info(
      argv.includes('--json')
        ? `${JSON.stringify({ description, name: 'npm-mockup' }, null, 2)}\n`
        : `${description}\n`,
    )
    return 0
  }
  const check = argv.includes('--check')
  const outIndex = argv.indexOf('--out-dir')
  const outDir =
    outIndex >= 0 && argv[outIndex + 1]
      ? argv[outIndex + 1]!
      : DEFAULT_NPM_MOCKUP_DIR
  mkdirSync(outDir, { recursive: true })
  let stale = 0
  for (let i = 0, { length } = NPM_MOCKUP_PAGES; i < length; i += 1) {
    const page = NPM_MOCKUP_PAGES[i]!
    const target = path.join(outDir, page.file)
    const html = page.render()
    if (check) {
      const current = readFileSync(target, 'utf8')
      if (current !== html) {
        stale += 1
        logger.error(`${page.file} is out of date`)
        logger.error('')
      }
      continue
    }
    writeFileSync(target, html)
    logger.info(`${target}`)
    logger.error('')
  }
  if (stale) {
    logger.error('Re-run this generator to refresh them.')
    logger.error('')
    return 1
  }
  return 0
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  process.exitCode = main()
}
