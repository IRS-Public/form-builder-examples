// Graph Inspector + Scenarios I/O: copy/load/reset the fact graph, load a scenario JSON, and
// AI scenario generation. Ported from credit-assistant. The EITC-specific scenario-filename
// parsing (parseScenarioFilename) and filterScenarios stay in credit-assistant and are injected
// via the panel's registerScenarioFilters(). Fetch bases are derived from the panel's
// `scenarios-base` and `api-base` attributes instead of hard-coded paths.

const DEFAULT_API_BASE = 'http://localhost:8000'

function _panel () {
  return document.querySelector('taxpert-audit-panel')
}

function _apiBase () {
  return _panel()?.getAttribute('api-base') || DEFAULT_API_BASE
}

function _scenariosBase () {
  // e.g. /app/eitc/resources/scenarios — the directory scenario JSONs are served from.
  return _panel()?.getAttribute('scenarios-base') || ''
}

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
  fetch(`${_scenariosBase()}/${select.value}`)
    .then(res => {
      if (!res.ok) throw new Error(res.statusText)
      return res.text()
    })
    .then(json => window.loadFactGraph(json))
    .catch(err => console.error('Failed to load scenario:', err))
}
window.loadScenarioFromAuditPanel = loadScenarioFromAuditPanel

// ── AI scenario generation ─────────────────────────────────────────────────────

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
    const res = await fetch(`${_apiBase()}/scenario/generate`, {
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
  generateScenarioFromPrompt,
  renderGeneratedScenarioResult,
  clearGeneratedScenario,
}
