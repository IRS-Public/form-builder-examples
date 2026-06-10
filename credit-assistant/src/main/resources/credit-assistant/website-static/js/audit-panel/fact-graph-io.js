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

export { loadScenarioFromAuditPanel, filterScenarios }
