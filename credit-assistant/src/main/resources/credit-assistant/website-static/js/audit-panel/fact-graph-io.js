/**
 * Copy the serialized fact graph JSON to the clipboard and flash the `#copy-fg-status` element's
 * success animation. Logs to console.error on clipboard failure.
 * @returns {Promise<void>}
 */
async function copyFactGraphToClipboard () {
  const fg = window.factGraph.toJson()
  const status = document.getElementById('copy-fg-status')
  try {
    await navigator.clipboard.writeText(fg)
    status.classList.add('animate-success')
    status.onanimationend = () => {
      status.classList.remove('animate-success')
    }
  } catch (err) {
    console.error(`Failed to copy: ${err}`)
  }
}
window.copyFactGraphToClipboard = copyFactGraphToClipboard

/* Attempt to load the Fact Graph and set a validation error if it fails
 *
 * It's important that this function either succeeds and triggers a new page load, or fails and sets
 * a validation message. Otherwise the form will attempt to "submit," accomplishing nothing. It
 * works this way because the custom validation message has to be set before the 'submit' event
 * fires (as far as I can tell).
 */
function loadFactGraphFromAuditPanel () {
  const textarea = document.querySelector('#load-fact-graph')
  const formGroup = textarea.closest('.usa-form-group')
  const label = formGroup.querySelector('.usa-label')
  let errorMessage = formGroup.querySelector('#load-fact-graph-error')

  try {
    window.loadFactGraph(textarea.value)
    if (errorMessage) {
      errorMessage.remove()
      textarea.classList.remove('usa-input--error')
      textarea.removeAttribute('aria-describedby')
      label.classList.remove('usa-label--error')
      formGroup.classList.remove('usa-form-group--error')
    }
  } catch (error) {
    const errorMessageId = 'load-fact-graph-error'
    if (!errorMessage) {
      errorMessage = document.createElement('span')
      errorMessage.id = errorMessageId
      errorMessage.className = 'usa-error-message'
      label.after(errorMessage)
      errorMessage.innerText = 'Enter a valid JSON'
      label.classList.add('usa-label--error')
      textarea.classList.add('usa-input--error')
      textarea.setAttribute('aria-describedby', errorMessageId)
      formGroup.classList.add('usa-form-group--error')
      textarea.focus()
    }
  }
}
window.loadFactGraphFromAuditPanel = loadFactGraphFromAuditPanel

function loadScenarioFromAuditPanel () {
  const select = document.querySelector('#scenario-select')
  if (!select || !select.value) return
  fetch(`/app/eitc/resources/scenarios/${select.value}`)
    .then(res => {
      if (!res.ok) throw new Error(res.statusText)
      return res.text()
    })
    .then(json => window.loadFactGraph(json))
    .catch(err => console.error('Failed to load scenario:', err))
}
window.loadScenarioFromAuditPanel = loadScenarioFromAuditPanel

// Scenario filenames encode several dimensions, e.g. `dq_hoh_unmarried_2024_1tp_3qcs_59899.json`:
// an optional `dq`/`ko` eligibility prefix, the filing status, an optional married/unmarried
// marital qualifier (HOH only), a `Nqc`/`Nqcs` qualifying-children token, and a trailing income amount.
function parseScenarioFilename (filename) {
  // Consume tokens with shift()/parts[0] (a literal index) instead of a variable
  // index parts[i], which trips security/detect-object-injection.
  const parts = filename.replace(/\.json$/, '').split('_')

  let eligibility = 'qualifying'
  if (parts[0] === 'dq') {
    eligibility = 'disqualifying'
    parts.shift()
  }

  const filingStatus = parts.shift()

  let marital = null
  if (filingStatus === 'hoh' && (parts[0] === 'married' || parts[0] === 'unmarried')) {
    marital = parts.shift()
  }

  // Number of qualifying children, encoded as a `Nqc`/`Nqcs` token (e.g. `3qcs`).
  // Iterate (no variable-indexed access) to keep security/detect-object-injection happy.
  let qcCount = ''
  for (const part of parts) {
    const match = /^(\d+)qcs?$/i.exec(part)
    if (match) {
      qcCount = match[1]
      break
    }
  }

  const income = parseInt(parts[parts.length - 1], 10)
  let incomeBand = 'none'
  if (!Number.isNaN(income)) {
    if (income < 20000) incomeBand = 'low'
    else if (income < 52000) incomeBand = 'mid-low'
    else if (income < 59000) incomeBand = 'mid-high'
    else incomeBand = 'high'
  }

  return { eligibility, filingStatus, marital, incomeBand, qcCount }
}

/**
 * Hide scenario `<option>`s that don't match the filter dropdowns (eligibility, filing status,
 * marital, income band, qc count), toggling the marital dropdown's visibility (HOH-only) and
 * clearing the selection if the chosen scenario falls outside the active filters.
 */
function filterScenarios () {
  const eligibility = document.querySelector('#scenario-filter-dq').value
  const filingStatus = document.querySelector('#scenario-filter-fs').value
  const marital = document.querySelector('#scenario-filter-marital').value
  const incomeBand = document.querySelector('#scenario-filter-income').value
  const qcCount = document.querySelector('#scenario-filter-qc').value

  // Marital status only applies to HOH, so hide that dropdown for the other statuses.
  const maritalGroup = document.querySelector('#scenario-filter-marital-group')
  if (maritalGroup) {
    maritalGroup.hidden = filingStatus !== '' && filingStatus !== 'hoh'
  }

  const select = document.querySelector('#scenario-select')
  for (const option of select.options) {
    if (!option.value) continue
    const scenario = parseScenarioFilename(option.value)
    option.hidden = Boolean(
      (eligibility && scenario.eligibility !== eligibility) ||
      (filingStatus && scenario.filingStatus !== filingStatus) ||
      (marital && scenario.marital !== marital) ||
      (incomeBand && scenario.incomeBand !== incomeBand) ||
      (qcCount && scenario.qcCount !== qcCount)
    )
  }

  const selectedOption = select.options[select.selectedIndex]
  if (selectedOption && selectedOption.hidden) select.value = ''
}

// ── AI scenario generation ─────────────────────────────────────────────────────

const SCENARIO_API_URL = 'http://localhost:8000/scenario/generate'
const SCENARIO_TIMEOUT_MS = 90_000
// sessionStorage key carrying the just-generated scenario across the loadFactGraph()
// page reload, so the description + Download button can render once the graph is live.
const GENERATED_SCENARIO_KEY = 'generatedScenario'

function _setGenStatus (text) {
  const el = document.getElementById('scenario-gen-status')
  if (el) el.textContent = text
}

// Animated "Generating… (Ns)" ticker; mirrors chat.js#_startThinkingAnimation.
function _startGeneratingAnimation () {
  const dots = ['', '.', '..', '...']
  let dotIdx = 0
  let elapsed = 0
  const id = setInterval(() => {
    elapsed++
    dotIdx = (dotIdx + 1) % dots.length
    // eslint-disable-next-line security/detect-object-injection
    _setGenStatus(`Generating${dots[dotIdx]} (${elapsed}s)`)
  }, 1000)
  return () => clearInterval(id)
}

/**
 * POST the user's description to the scenario-generation backend, then load the returned
 * draft Fact Graph. loadFactGraph() validates synchronously via GraphFactory.fromJSON
 * (throwing before its deferred reload), so an invalid draft is caught here and nothing is
 * persisted. On success the draft is stashed so renderGeneratedScenarioResult() can show the
 * description + Download button after the page reload.
 */
async function generateScenarioFromPrompt () {
  const textarea = document.querySelector('#scenario-gen-prompt')
  const prompt = textarea?.value.trim()
  if (!prompt) return

  const btn = document.querySelector('#generate-scenario-btn')
  const result = document.getElementById('scenario-gen-result')
  if (result) result.hidden = true
  sessionStorage.removeItem(GENERATED_SCENARIO_KEY)
  btn?.setAttribute('disabled', 'true')
  _setGenStatus('Generating…')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SCENARIO_TIMEOUT_MS)
  const stopAnimation = _startGeneratingAnimation()

  try {
    const res = await fetch(SCENARIO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      _setGenStatus(`Error: ${data.detail ?? res.statusText}`)
      return
    }

    const data = await res.json()
    const serialized = JSON.stringify(data.scenario_json)

    // Stash before loading so the result survives loadFactGraph()'s reload. Removed again
    // if the graph turns out to be invalid (fromJSON throws below).
    sessionStorage.setItem(
      GENERATED_SCENARIO_KEY,
      JSON.stringify({ serialized, filename: data.filename, description: data.description })
    )

    try {
      window.loadFactGraph(serialized) // validates + saves + reloads the page
    } catch (err) {
      sessionStorage.removeItem(GENERATED_SCENARIO_KEY)
      _setGenStatus(`The generated scenario could not be loaded: ${err.message ?? 'invalid graph'}`)
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      _setGenStatus('Request timed out — the backend took too long to respond.')
    } else {
      _setGenStatus(`Error: ${err.message ?? 'Request failed'}`)
    }
  } finally {
    clearTimeout(timeoutId)
    stopAnimation()
    btn?.removeAttribute('disabled')
  }
}

// Trigger a client-side download of `text` as `filename` (Blob + temporary <a download>).
function _downloadJson (filename, text) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * After loadFactGraph()'s reload, surface the generated scenario's description and wire the
 * Download button. No-op when there's no generated scenario in this session.
 */
function renderGeneratedScenarioResult () {
  const raw = sessionStorage.getItem(GENERATED_SCENARIO_KEY)
  if (!raw) return
  let stashed
  try {
    stashed = JSON.parse(raw)
  } catch {
    sessionStorage.removeItem(GENERATED_SCENARIO_KEY)
    return
  }

  const result = document.getElementById('scenario-gen-result')
  const description = document.getElementById('scenario-gen-description')
  const downloadBtn = document.getElementById('download-scenario-btn')
  if (!result || !description || !downloadBtn) return

  description.textContent = stashed.description || ''
  result.hidden = false
  _setGenStatus('Scenario generated and loaded.')
  downloadBtn.onclick = () =>
    _downloadJson(stashed.filename || 'scenario.json', stashed.serialized || '')
}

// Drop any generated-scenario state (called when the user clears the active scenario).
function clearGeneratedScenario () {
  sessionStorage.removeItem(GENERATED_SCENARIO_KEY)
  const result = document.getElementById('scenario-gen-result')
  if (result) result.hidden = true
}

export {
  loadScenarioFromAuditPanel,
  filterScenarios,
  generateScenarioFromPrompt,
  renderGeneratedScenarioResult,
  clearGeneratedScenario,
}
