/**
 * @file The dropdown a reader picks from, rendered once for three surfaces.
 *   ONE SHAPE, THREE RENDERERS. A picker is a list of rows with exactly one
 *   selected and at most one marked as the fleet's default. That shape has
 *   nothing to do with HTML, so the report page, a flat terminal listing, and
 *   the interactive list a reader arrows through render the SAME rows rather
 *   than each deriving their own and drifting.
 *   THE DEFAULT IS ALWAYS VISIBLE. A reader changing a setting should be able
 *   to see what they are trading away, so the fleet's pick is marked even when
 *   something else is selected. A picker that hides the default makes the
 *   decision look arbitrary.
 *   EVERY ROW IS ESCAPED. Model ids and notes come from a provider's API, which
 *   is untrusted text landing in a page. Escaping happens here rather than at
 *   each call site, because the one call site that forgets is the whole bug.
 */

/**
 * One choice in a picker.
 */
export interface PickerChoice {
  /**
   * The value stored when this row is chosen.
   */
  readonly id: string
  /**
   * Whether this is the fleet's pick, shown even when another is selected.
   */
  readonly isDefault: boolean
  /**
   * What a reader sees.
   */
  readonly label: string
  /**
   * Why this choice exists, shown beside it. Empty when there is nothing to
   * say.
   */
  readonly note: string
  readonly selected: boolean
}

export interface PickerGroup {
  readonly choices: readonly PickerChoice[]
  /**
   * The form field name, and the key a selection is stored under.
   */
  readonly name: string
  readonly title: string
}

/**
 * Escape text for HTML. Model ids and notes arrive from a provider's API, so
 * they are untrusted text going into a page.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The suffix marking a row as the fleet's pick, or nothing.
 *
 * Shared so the two renderers cannot disagree about which row is the default -
 * the one thing a reader uses the picker to compare against.
 */
export function defaultSuffix(choice: PickerChoice): string {
  return choice.isDefault ? ' (fleet default)' : ''
}

/**
 * Render a group as a `<select>`.
 *
 * The selected row carries `selected` so the control opens on the current
 * value rather than the first one, which would silently misreport the setting
 * every time the page loaded.
 */
export function renderSelect(group: PickerGroup): string {
  const options = group.choices.map(choice => {
    const note = choice.note ? ` - ${choice.note}` : ''
    const text = escapeHtml(`${choice.label}${defaultSuffix(choice)}${note}`)
    return `    <option value="${escapeHtml(choice.id)}"${choice.selected ? ' selected' : ''}>${text}</option>`
  })
  return [
    `<label class="picker" for="${escapeHtml(group.name)}">`,
    `  <span class="picker-title">${escapeHtml(group.title)}</span>`,
    `  <select id="${escapeHtml(group.name)}" name="${escapeHtml(group.name)}">`,
    ...options,
    '  </select>',
    '</label>',
  ].join('\n')
}

/**
 * Render a group as terminal lines, for a CLI that has no DOM.
 *
 * The selected row is marked rather than merely ordered first, because a reader
 * scanning a list needs to see WHICH is active without counting.
 */
export function renderPickerLines(group: PickerGroup): string[] {
  const lines = [`${group.title}:`]
  for (let i = 0, { length } = group.choices; i < length; i += 1) {
    const choice = group.choices[i]!
    const marker = choice.selected ? '*' : ' '
    const note = choice.note ? ` - ${choice.note}` : ''
    lines.push(`  ${marker} ${choice.label}${defaultSuffix(choice)}${note}`)
  }
  return lines
}

/**
 * One row as an interactive prompt takes it.
 *
 * A third rendering of the same rows, alongside the `<select>` and the flat
 * lines. The list a reader arrows through and the list the page shows have to
 * agree about which row is the fleet's pick, and they only can if the marker is
 * computed once.
 */
export interface PromptChoice {
  /**
   * Shown under the highlighted row, where there is space for it.
   */
  readonly description: string
  readonly name: string
  readonly value: string
}

/**
 * Render a group as choices for an interactive list prompt.
 *
 * The selected row is NOT marked in the text: a prompt highlights the current
 * value itself, and a second marker beside it would read as two different rows
 * being current. The fleet's default still is, because nothing else shows it.
 */
export function renderPromptChoices(group: PickerGroup): PromptChoice[] {
  const choices: PromptChoice[] = []
  for (let i = 0, { length } = group.choices; i < length; i += 1) {
    const choice = group.choices[i]!
    choices.push({
      description: choice.note,
      name: `${choice.label}${defaultSuffix(choice)}`,
      value: choice.id,
    })
  }
  return choices
}

/**
 * The id a group resolves to, or undefined when nothing is selected.
 *
 * Undefined is a real state rather than a bug: a group whose stored selection
 * named a model the provider has since retired has no valid row to mark, and
 * the caller falls back to its own default rather than showing a wrong one.
 */
export function selectedIdOf(group: PickerGroup): string | undefined {
  for (let i = 0, { length } = group.choices; i < length; i += 1) {
    const choice = group.choices[i]!
    if (choice.selected) {
      return choice.id
    }
  }
  return undefined
}
