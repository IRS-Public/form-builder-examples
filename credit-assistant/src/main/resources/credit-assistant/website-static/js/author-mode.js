// Author Mode client — renders the structured-form editor from the embedded
// authoring server's model, and drives live validate / save / commit.
//
// ─── API CONTRACT (must stay in sync with authoring/AuthoringServer.scala) ────
//
// Base URL: the authoring server runs on its own port (3004) while this page is
// served by smol (3003), so every request is an absolute cross-origin fetch to
// AUTHOR_API_BASE. The backend must send permissive CORS headers (see below).
//
//   GET  /author/model    → {
//     screens:  [ { route, title,
//                   fgSets: [ { path, question, hint, inputType, factType,
//                               validInputTypes: [ '...' ], ifTrue, ifFalse } ],
//                   alerts: [ { id, text, alertType, knockout, condition, operator } ] } ],
//     facts:    [ { path, description, kind, constantValue, constantType,
//                   type, placeholder: { valueType, value } | null,
//                   limits: [ { limitType, valueType, value } ], file } ],
//     writablePaths: [ "/..." ],
//     booleanPaths:  [ "/..." ],
//     numericPaths:  [ "/..." ]
//   }
//
//   GET  /author/lint     → { warnings: [ { message, route } ] }
//
// A screen (page) can carry several `<fg-set>` blocks — one per collection item or
// income source — each with its own question/hint, so they're modeled as a list keyed
// by the fg-set's (unique) fact `path`, not a single question/hint per screen.
//
//   POST /author/validate  body { target, edit } → { ok, errors: [ { field, message } ] }
//   POST /author/save      body { target, edit } → { ok, errors: [ { field, message } ] }
//   POST /author/commit    body { summary }      → { ok, sha, stderr }
//
// The edit-payload shape sent to /author/validate and /author/save:
//
//   target = {
//     kind:  'constant' | 'factDescription' | 'screenText'   // MVP
//          | 'screenAttr' | 'alertAttr' | 'factConfig',      // v1 structural
//     path:  '<fact path>',      // constant | factDescription | factConfig
//                                //   | screenText/screenAttr (question/hint/input/gating: identifies the fg-set)
//     file:  '<source file>',    // constant | factDescription | factConfig (echoed from model)
//     route: '<screen route>',   // screenText | screenAttr | alertAttr
//     field: 'question' | 'hint' | 'alert'          // screenText
//          | 'inputType' | 'path' | 'gating'        // screenAttr (fg-set)
//          | 'alertType' | 'knockout' | 'condition' | 'operator'  // alertAttr
//          | 'placeholder' | 'limitMin' | 'limitMax',            // factConfig
//     alertId: '<alert id>'      // screenText (field==='alert') | alertAttr
//   }
//   edit = { value: '<new string>', polarity?: 'if-true' | 'if-false' | 'none' }  // polarity: screenAttr gating only
//
// One target === one editable field === one error slot. Errors in the response
// apply to whichever field the request was for; all messages are shown inline.
// ──────────────────────────────────────────────────────────────────────────────

// Single source of truth for the authoring server origin. If the port changes,
// change it here only.
const AUTHOR_API_BASE = 'http://localhost:3004'

// Centralized model-field access. The backend agent may rename fields; if so,
// update these accessors (one line each) and nothing else in this file breaks.
const field = {
  screens: (m) => m.screens || [],
  facts: (m) => m.facts || [],
  writablePaths: (m) => m.writablePaths || [],
  booleanPaths: (m) => m.booleanPaths || [],
  factPath: (f) => f.path,
  factDescription: (f) => f.description,
  factKind: (f) => f.kind,
  factFile: (f) => f.file,
  factType: (f) => f.type,
  factPlaceholder: (f) => f.placeholder,
  factLimits: (f) => f.limits || [],
  constantValue: (f) => f.constantValue,
  constantType: (f) => f.constantType,
  screenRoute: (s) => s.route,
  screenTitle: (s) => s.title,
  screenFgSets: (s) => s.fgSets || [],
  screenAlerts: (s) => s.alerts || [],
  fgSetPath: (b) => b.path,
  fgSetQuestion: (b) => b.question,
  fgSetHint: (b) => b.hint,
  fgSetInputType: (b) => b.inputType,
  fgSetValidInputTypes: (b) => b.validInputTypes || [],
  fgSetIfTrue: (b) => b.ifTrue,
  fgSetIfFalse: (b) => b.ifFalse,
  alertId: (a) => a.id,
  alertText: (a) => a.text,
  alertType: (a) => a.alertType,
  alertKnockout: (a) => a.knockout,
  alertCondition: (a) => a.condition,
  alertOperator: (a) => a.operator
}

// Fixed vocabularies mirrored from FlowConfig.rng (the schema is the source of truth;
// the backend re-validates every edit, so these only shape the dropdowns).
const ALL_INPUT_TYPES = ['dollar', 'text', 'date', 'int', 'boolean', 'enum', 'multi-enum', 'select']
const ALERT_TYPES = ['error', 'info', 'warning', 'success', 'emergency']
const ALERT_OPERATORS = ['isTrue', 'isFalse']
// fact-graph type node → the scalar type placeholders/limits use. A fact whose type
// isn't here (Boolean, Enum, Collection…) has no simple placeholder/limit to author.
const SCALAR_TYPE_NODES = {
  DollarNode: 'Dollar',
  IntNode: 'Int',
  RationalNode: 'Rational',
  DayNode: 'Day',
  StringNode: 'String'
}

const VALIDATE_DEBOUNCE_MS = 350

/** Build an absolute authoring-server URL for a path like '/author/model'. */
function apiUrl (path) {
  return `${AUTHOR_API_BASE}${path}`
}

/** POST JSON and parse the JSON response. Throws on network / non-OK responses. */
async function postJson (path, body) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  return response.json()
}

/** GET a JSON resource from the authoring server. Throws on network / non-OK responses. */
async function getJson (path) {
  const response = await fetch(apiUrl(path))
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  return response.json()
}

/** Show the top-of-page status banner with a message and an alert flavor. */
function setStatus (message, kind = 'info') {
  const banner = document.getElementById('author-status')
  const text = document.getElementById('author-status-text')
  if (!banner || !text) return
  banner.hidden = false
  banner.classList.remove('usa-alert--info', 'usa-alert--warning', 'usa-alert--error', 'usa-alert--success')
  banner.classList.add(`usa-alert--${kind}`)
  text.textContent = message
}

let debounceTimer = null
function debounce (fn) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(fn, VALIDATE_DEBOUNCE_MS)
}

/** Join the messages from an errors array into a single inline string. */
function errorText (errors) {
  if (!Array.isArray(errors) || errors.length === 0) return ''
  return errors.map((e) => e.message).join(' ')
}

/** Warn (once, in the status banner) when the authoring server is unreachable. */
function reportUnreachable (verb) {
  setStatus(`Could not reach the authoring server to ${verb}. Is \`make dev-author\` running?`, 'warning')
}

let fieldCounter = 0

/**
 * The shared validate/save workflow behind every editor. Renders a labeled row of one
 * or more controls + an inline error + a Save button, and wires:
 *   - on input/change of any control → debounced POST /author/validate
 *   - Save click → POST /author/save
 * The Save button enables only when the edit is valid AND changed from its saved state.
 *
 * @param {object} opts
 * @param {string} opts.label
 * @param {HTMLElement[]} opts.controls  controls to render, in order
 * @param {() => string} opts.signature  a string snapshot of the current control values (dirty check)
 * @param {() => object} opts.getPayload builds the { target, edit } sent to validate/save
 * @param {string} [opts.hint]           small helper text under the label
 * @returns {HTMLElement}
 */
function buildEditor (opts) {
  const id = `author-field-${fieldCounter++}`
  const wrapper = document.createElement('div')
  wrapper.className = 'author__field usa-form-group'

  const label = document.createElement('label')
  label.className = 'usa-label'
  label.setAttribute('for', opts.controls[0].id || id)
  label.textContent = opts.label
  wrapper.appendChild(label)

  if (opts.hint) {
    const hint = document.createElement('span')
    hint.className = 'usa-hint author__field-hint'
    hint.textContent = opts.hint
    wrapper.appendChild(hint)
  }

  const errorId = `${id}-error`
  for (const control of opts.controls) {
    control.setAttribute('aria-describedby', errorId)
    wrapper.appendChild(control)
  }

  const error = document.createElement('span')
  error.className = 'author__field-error usa-error-message'
  error.id = errorId
  error.hidden = true
  wrapper.appendChild(error)

  const actions = document.createElement('div')
  actions.className = 'author__field-actions'
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'usa-button usa-button--outline'
  saveBtn.textContent = 'Save'
  saveBtn.disabled = true
  const savedNote = document.createElement('span')
  savedNote.className = 'author__field-saved'
  savedNote.setAttribute('role', 'status')
  actions.appendChild(saveBtn)
  actions.appendChild(savedNote)
  wrapper.appendChild(actions)

  const original = opts.signature()
  let valid = true

  const showErrors = (errors) => {
    const message = errorText(errors)
    if (message) {
      error.textContent = message
      error.hidden = false
      valid = false
    } else {
      error.textContent = ''
      error.hidden = true
      valid = true
    }
    for (const control of opts.controls) {
      control.setAttribute('aria-invalid', String(!valid))
    }
    saveBtn.disabled = !valid || opts.signature() === original
  }

  const runValidate = async () => {
    try {
      const result = await postJson('/author/validate', opts.getPayload())
      showErrors(result.ok ? [] : result.errors)
    } catch (err) {
      console.error('validate failed', err)
      reportUnreachable('validate')
    }
  }

  for (const control of opts.controls) {
    for (const evt of ['input', 'change']) {
      control.addEventListener(evt, () => {
        savedNote.textContent = ''
        saveBtn.disabled = true
        debounce(runValidate)
      })
    }
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true
    try {
      const result = await postJson('/author/save', opts.getPayload())
      if (result.ok) {
        showErrors([])
        savedNote.textContent = 'Saved. Refresh Product Experience or Browse All to preview.'
        saveBtn.disabled = true
      } else {
        showErrors(result.errors)
      }
    } catch (err) {
      console.error('save failed', err)
      reportUnreachable('save')
      saveBtn.disabled = false
    }
  })

  return wrapper
}

// ─── Control factories ────────────────────────────────────────────────────────

/** A text <input> or <textarea>, pre-filled with `value`. */
function makeTextControl (value, { multiline, numeric } = {}) {
  const control = multiline ? document.createElement('textarea') : document.createElement('input')
  control.id = `author-field-${fieldCounter++}`
  control.className = multiline ? 'usa-textarea' : 'usa-input'
  control.value = value == null ? '' : String(value)
  control.setAttribute('aria-invalid', 'false')
  if (!multiline && numeric) control.setAttribute('inputmode', 'decimal')
  return control
}

/**
 * A <select> pre-selecting `selected`. `options` is an array of strings or
 * { value, label } objects. When `blankLabel` is given, a leading empty option is added.
 */
function makeSelectControl (options, selected, { blankLabel } = {}) {
  const control = document.createElement('select')
  control.id = `author-field-${fieldCounter++}`
  control.className = 'usa-select'
  if (blankLabel != null) {
    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = blankLabel
    control.appendChild(blank)
  }
  for (const opt of options) {
    const value = typeof opt === 'string' ? opt : opt.value
    const text = typeof opt === 'string' ? opt : opt.label
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    control.appendChild(option)
  }
  control.value = selected == null ? '' : String(selected)
  return control
}

// ─── Editor builders (compose controls + the shared workflow) ───────────────────

/** Single free-text field editor (question, hint, alert text, description). */
function buildTextEditor ({ label, hint, initialValue, multiline, numeric, target }) {
  const control = makeTextControl(initialValue, { multiline, numeric })
  return buildEditor({
    label,
    hint,
    controls: [control],
    signature: () => control.value,
    getPayload: () => ({ target, edit: { value: control.value } })
  })
}

/** Single-select field editor (input type, alert type, knockout, condition, operator, path rebind). */
function buildSelectEditor ({ label, hint, options, selected, blankLabel, target }) {
  const control = makeSelectControl(options, selected, { blankLabel })
  return buildEditor({
    label,
    hint,
    controls: [control],
    signature: () => control.value,
    getPayload: () => ({ target, edit: { value: control.value } })
  })
}

/**
 * The fg-set gating editor: a polarity select ("Always shown" / "Show when true" /
 * "Show when false") plus a Boolean-fact select. They're saved together as one
 * `screenAttr/gating` edit so if-true and if-false never coexist.
 */
function buildGatingEditor ({ route, fgSetPath, booleanPaths, ifTrue, ifFalse }) {
  const initialPolarity = ifTrue ? 'if-true' : ifFalse ? 'if-false' : 'none'
  const initialPath = ifTrue || ifFalse || ''

  const polarity = makeSelectControl(
    [
      { value: 'none', label: 'Always shown' },
      { value: 'if-true', label: 'Show only when a fact is true' },
      { value: 'if-false', label: 'Show only when a fact is false' }
    ],
    initialPolarity
  )
  const gatePath = makeSelectControl(booleanPaths, initialPath, { blankLabel: 'Select a Boolean fact…' })
  gatePath.disabled = initialPolarity === 'none'

  polarity.addEventListener('change', () => {
    gatePath.disabled = polarity.value === 'none'
    if (polarity.value === 'none') gatePath.value = ''
  })

  return buildEditor({
    label: 'Show this question when…',
    hint: 'Gate the question on a Boolean fact. "Always shown" clears any condition.',
    controls: [polarity, gatePath],
    signature: () => `${polarity.value}|${gatePath.value}`,
    getPayload: () => ({
      target: { kind: 'screenAttr', route, path: fgSetPath, field: 'gating' },
      edit: { value: polarity.value === 'none' ? '' : gatePath.value, polarity: polarity.value }
    })
  })
}

/** Replace the children of a container element with a single node (or clear it). */
function replaceChildren (container, node) {
  container.textContent = ''
  if (node) container.appendChild(node)
}

/** Populate a <select> with options built from items, keyed by a Map for lookup. */
function populateSelect (select, items, valueOf, labelOf) {
  const lookup = new Map()
  for (const item of items) {
    const value = valueOf(item)
    lookup.set(value, item)
    const option = document.createElement('option')
    option.value = value
    option.textContent = labelOf(item)
    select.appendChild(option)
  }
  return lookup
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderConstantEditor (model) {
  const select = document.getElementById('author-constant-select')
  const fields = document.getElementById('author-constant-fields')
  if (!select || !fields) return

  const constants = field.facts(model).filter((f) => field.factKind(f) === 'constant')
  const lookup = populateSelect(
    select,
    constants,
    (f) => field.factPath(f),
    (f) => `${field.factPath(f)}  (${field.constantType(f) || 'value'})`
  )

  select.addEventListener('change', () => {
    const fact = lookup.get(select.value)
    if (!fact) return replaceChildren(fields, null)
    const editor = buildTextEditor({
      label: `Value — ${field.constantType(fact) || 'constant'} in ${field.factFile(fact) || 'source XML'}`,
      initialValue: field.constantValue(fact),
      numeric: true,
      target: {
        kind: 'constant',
        path: field.factPath(fact),
        file: field.factFile(fact)
      }
    })
    replaceChildren(fields, editor)
  })
}

function renderDescriptionEditor (model) {
  const select = document.getElementById('author-description-select')
  const fields = document.getElementById('author-description-fields')
  if (!select || !fields) return

  const facts = field.facts(model)
  const lookup = populateSelect(
    select,
    facts,
    (f) => field.factPath(f),
    (f) => field.factPath(f)
  )

  select.addEventListener('change', () => {
    const fact = lookup.get(select.value)
    if (!fact) return replaceChildren(fields, null)
    const editor = buildTextEditor({
      label: `Description — ${field.factPath(fact)}`,
      initialValue: field.factDescription(fact),
      multiline: true,
      target: {
        kind: 'factDescription',
        path: field.factPath(fact),
        file: field.factFile(fact)
      }
    })
    replaceChildren(fields, editor)
  })
}

/**
 * Fact configuration (T15): edit a writable scalar fact's default (<Placeholder>) and
 * its Min/Max validation bounds (<Limit>). Only writable facts with a simple scalar
 * type (Dollar/Int/Rational/Day/String) are offered. Clearing a field removes it.
 */
function renderFactConfigEditor (model) {
  const select = document.getElementById('author-factconfig-select')
  const fields = document.getElementById('author-factconfig-fields')
  if (!select || !fields) return

  const facts = field
    .facts(model)
    .filter((f) => field.factKind(f) === 'writable' && SCALAR_TYPE_NODES[field.factType(f)])
  const lookup = populateSelect(
    select,
    facts,
    (f) => field.factPath(f),
    (f) => `${field.factPath(f)}  (${SCALAR_TYPE_NODES[field.factType(f)]})`
  )

  select.addEventListener('change', () => {
    const fact = lookup.get(select.value)
    fields.textContent = ''
    if (!fact) return

    const path = field.factPath(fact)
    const file = field.factFile(fact)
    const numeric = ['Dollar', 'Int', 'Rational'].includes(SCALAR_TYPE_NODES[field.factType(fact)])
    const limits = field.factLimits(fact)
    const placeholder = field.factPlaceholder(fact)
    const limitOf = (type) => (limits.find((l) => l.limitType === type) || {}).value || ''

    fields.appendChild(buildTextEditor({
      label: 'Default value (placeholder)',
      hint: 'The value used when the filer leaves this blank. Clear to remove.',
      initialValue: placeholder ? placeholder.value : '',
      numeric,
      target: { kind: 'factConfig', path, file, field: 'placeholder' }
    }))
    fields.appendChild(buildTextEditor({
      label: 'Minimum allowed (Limit type="Min")',
      hint: 'Reject answers below this. Clear to remove.',
      initialValue: limitOf('Min'),
      numeric,
      target: { kind: 'factConfig', path, file, field: 'limitMin' }
    }))
    fields.appendChild(buildTextEditor({
      label: 'Maximum allowed (Limit type="Max")',
      hint: 'Reject answers above this. Clear to remove.',
      initialValue: limitOf('Max'),
      numeric,
      target: { kind: 'factConfig', path, file, field: 'limitMax' }
    }))
  })
}

/** Trim display text for a <select> option label. */
function truncateLabel (text, max = 70) {
  if (!text) return ''
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

/** Reset a <select> to just its disabled placeholder option. */
function resetSelectToPlaceholder (select, placeholderText, disabled) {
  select.textContent = ''
  select.disabled = disabled
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.disabled = true
  placeholder.selected = true
  placeholder.textContent = placeholderText
  select.appendChild(placeholder)
}

/**
 * Screen text/structure is edited in two steps: pick a screen, then pick one of its
 * editable blocks — an `<fg-set>` (question, hint, input type, bound fact, gating) or an
 * `<fg-alert>` (heading, alert type, knockout, condition) — and every editor within that
 * block is rendered at once.
 */
function renderScreenEditor (model) {
  const screenSelect = document.getElementById('author-screen-select')
  const blockSelect = document.getElementById('author-block-select')
  const fields = document.getElementById('author-screen-fields')
  if (!screenSelect || !blockSelect || !fields) return

  const screens = field.screens(model)
  const writablePaths = field.writablePaths(model)
  const booleanPaths = field.booleanPaths(model)
  const screenLookup = populateSelect(
    screenSelect,
    screens,
    (s) => field.screenRoute(s),
    (s) => `${field.screenTitle(s) || field.screenRoute(s)}  —  ${field.screenRoute(s)}`
  )

  let blockLookup = new Map()

  function renderFgSetBlock (route, data) {
    const fgSetPath = field.fgSetPath(data)

    fields.appendChild(buildTextEditor({
      label: 'Question',
      initialValue: field.fgSetQuestion(data),
      multiline: true,
      target: { kind: 'screenText', route, field: 'question', path: fgSetPath }
    }))

    if (field.fgSetHint(data) != null && field.fgSetHint(data) !== '') {
      fields.appendChild(buildTextEditor({
        label: 'Hint',
        initialValue: field.fgSetHint(data),
        multiline: true,
        target: { kind: 'screenText', route, field: 'hint', path: fgSetPath }
      }))
    }

    // Structural (v1): input type, bound fact, gating.
    const validTypes = field.fgSetValidInputTypes(data)
    fields.appendChild(buildSelectEditor({
      label: 'Input type',
      hint: `Bound fact is ${field.factType(data) || 'unknown'}; only compatible types will validate.`,
      options: validTypes.length ? validTypes : ALL_INPUT_TYPES,
      selected: field.fgSetInputType(data),
      target: { kind: 'screenAttr', route, path: fgSetPath, field: 'inputType' }
    }))

    fields.appendChild(buildSelectEditor({
      label: 'Bound fact (writable)',
      hint: 'The writable fact this question answers.',
      options: writablePaths,
      selected: fgSetPath,
      blankLabel: writablePaths.includes(fgSetPath) ? undefined : `${fgSetPath} (current)`,
      target: { kind: 'screenAttr', route, path: fgSetPath, field: 'path' }
    }))

    fields.appendChild(buildGatingEditor({
      route,
      fgSetPath,
      booleanPaths,
      ifTrue: field.fgSetIfTrue(data),
      ifFalse: field.fgSetIfFalse(data)
    }))
  }

  function renderAlertBlock (route, data) {
    const alertId = field.alertId(data)

    fields.appendChild(buildTextEditor({
      label: `Alert text — ${alertId}`,
      initialValue: field.alertText(data),
      multiline: true,
      target: { kind: 'screenText', route, field: 'alert', alertId }
    }))

    fields.appendChild(buildSelectEditor({
      label: 'Alert type',
      hint: 'Knockout alerts must be "error".',
      options: ALERT_TYPES,
      selected: field.alertType(data),
      target: { kind: 'alertAttr', route, alertId, field: 'alertType' }
    }))

    fields.appendChild(buildSelectEditor({
      label: 'Knockout (blocks navigation)',
      options: [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }],
      selected: String(field.alertKnockout(data)),
      target: { kind: 'alertAttr', route, alertId, field: 'knockout' }
    }))

    fields.appendChild(buildSelectEditor({
      label: 'Condition fact (Boolean)',
      hint: 'Show the alert based on this Boolean fact.',
      options: booleanPaths,
      selected: field.alertCondition(data),
      blankLabel: 'No condition',
      target: { kind: 'alertAttr', route, alertId, field: 'condition' }
    }))

    fields.appendChild(buildSelectEditor({
      label: 'Condition operator',
      options: ALERT_OPERATORS,
      selected: field.alertOperator(data),
      blankLabel: 'No operator',
      target: { kind: 'alertAttr', route, alertId, field: 'operator' }
    }))
  }

  function renderBlock (block) {
    fields.textContent = ''
    if (!block) return
    if (block.kind === 'fgSet') renderFgSetBlock(block.route, block.data)
    else if (block.kind === 'alert') renderAlertBlock(block.route, block.data)
  }

  screenSelect.addEventListener('change', () => {
    const screen = screenLookup.get(screenSelect.value)
    blockLookup = new Map()
    fields.textContent = ''

    if (!screen) {
      resetSelectToPlaceholder(blockSelect, 'Select a screen first…', true)
      return
    }

    const route = field.screenRoute(screen)
    resetSelectToPlaceholder(blockSelect, 'Select a question or alert…', false)

    const fgSets = field.screenFgSets(screen)
    if (fgSets.length > 0) {
      const group = document.createElement('optgroup')
      group.label = 'Questions'
      for (const fgSet of fgSets) {
        const key = `fgSet:${field.fgSetPath(fgSet)}`
        blockLookup.set(key, { kind: 'fgSet', route, data: fgSet })
        const option = document.createElement('option')
        option.value = key
        option.textContent = truncateLabel(field.fgSetQuestion(fgSet)) || field.fgSetPath(fgSet)
        group.appendChild(option)
      }
      blockSelect.appendChild(group)
    }

    const alerts = field.screenAlerts(screen)
    if (alerts.length > 0) {
      const group = document.createElement('optgroup')
      group.label = 'Alerts'
      for (const alert of alerts) {
        const key = `alert:${field.alertId(alert)}`
        blockLookup.set(key, { kind: 'alert', route, data: alert })
        const option = document.createElement('option')
        option.value = key
        option.textContent = `Alert — ${field.alertId(alert)}`
        group.appendChild(option)
      }
      blockSelect.appendChild(group)
    }
  })

  blockSelect.addEventListener('change', () => {
    renderBlock(blockLookup.get(blockSelect.value))
  })
}

/** Soft-lint panel (T14): fetch and list non-blocking authoring warnings on demand. */
function wireLintPanel () {
  const button = document.getElementById('author-lint-btn')
  const results = document.getElementById('author-lint-results')
  if (!button || !results) return

  button.addEventListener('click', async () => {
    button.disabled = true
    results.textContent = 'Checking…'
    try {
      const { warnings } = await getJson('/author/lint')
      results.textContent = ''
      if (!warnings || warnings.length === 0) {
        const ok = document.createElement('p')
        ok.className = 'author__lint-ok'
        ok.textContent = 'No lint warnings. 🎉'
        results.appendChild(ok)
        return
      }
      const list = document.createElement('ul')
      list.className = 'author__lint-list'
      for (const w of warnings) {
        const item = document.createElement('li')
        item.className = 'author__lint-item'
        const message = document.createElement('span')
        message.textContent = w.message
        item.appendChild(message)
        if (w.route) {
          const route = document.createElement('code')
          route.className = 'author__lint-route'
          route.textContent = w.route
          item.appendChild(route)
        }
        list.appendChild(item)
      }
      results.appendChild(list)
    } catch (err) {
      console.error('lint failed', err)
      results.textContent = 'Could not reach the authoring server to lint. Is `make dev-author` running?'
    } finally {
      button.disabled = false
    }
  })
}

function wireCommit () {
  const summary = document.getElementById('author-commit-summary')
  const button = document.getElementById('author-commit-btn')
  const result = document.getElementById('author-commit-result')
  if (!summary || !button || !result) return

  button.addEventListener('click', async () => {
    if (!summary.value.trim()) {
      result.textContent = 'Enter a commit summary first.'
      result.className = 'author__commit-result author__commit-result--error'
      return
    }
    button.disabled = true
    result.textContent = 'Committing…'
    result.className = 'author__commit-result'
    try {
      const response = await postJson('/author/commit', { summary: summary.value.trim() })
      if (response.ok) {
        result.textContent = `Committed ${response.sha || ''}`.trim()
        result.className = 'author__commit-result author__commit-result--success'
        summary.value = ''
      } else {
        result.textContent = response.stderr || 'Commit failed.'
        result.className = 'author__commit-result author__commit-result--error'
      }
    } catch (err) {
      console.error('commit failed', err)
      result.textContent = 'Could not reach the authoring server to commit. Is `make dev-author` running?'
      result.className = 'author__commit-result author__commit-result--error'
    } finally {
      button.disabled = false
    }
  })
}

/** Fetch the model and render all editors. Exposed for tests / manual re-init. */
export async function init () {
  setStatus('Connecting to the authoring server…', 'info')
  try {
    const model = await getModel()
    renderConstantEditor(model)
    renderDescriptionEditor(model)
    renderFactConfigEditor(model)
    renderScreenEditor(model)
    wireLintPanel()
    wireCommit()
    document.getElementById('author-status').hidden = true
  } catch (err) {
    console.error('Author Mode could not load the model', err)
    setStatus(
      'Could not load the editing model. Start the authoring server with `make dev-author` (it listens on port 3004), then reload.',
      'error'
    )
  }
}

/** GET the current editable model. Throws on network / non-OK responses. */
async function getModel () {
  return getJson('/author/model')
}

window.initAuthorMode = init

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true })
} else {
  init()
}
