// Credit-assistant-owned EITC scenario-filter vocabulary for the shared <taxpert-audit-panel>.
// The generic filtering loop lives in the panel (registerScenarioFilters); this file supplies the
// EITC-specific pieces that stay in credit-assistant: the scenario-filename parsing convention and
// the five filter-dropdown descriptors (formerly parseScenarioFilename + the filter <select>s in
// fragments/audit-panel/scenarios-section.html).

// Scenario filenames encode several dimensions, e.g. `dq_hoh_unmarried_2024_1tp_3qcs_59899.json`:
// an optional `dq`/`ko` eligibility prefix, the filing status, an optional married/unmarried
// marital qualifier (HOH only), a `Nqc`/`Nqcs` qualifying-children token, and a trailing income amount.
export function parseScenarioFilename (filename) {
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

// The five filter dropdowns, ported from scenarios-section.html. Each `key` names the
// parseScenarioFilename() dimension the dropdown filters on; `showFor` (marital only) hides the
// group unless another filter's value is in the given set (HOH-only, matching the original).
const SCENARIO_FILTER_FIELDS = [
  {
    id: 'scenario-filter-dq',
    key: 'eligibility',
    label: 'Eligibility',
    options: [
      { value: '', label: 'All' },
      { value: 'qualifying', label: 'Qualifying' },
      { value: 'disqualifying', label: 'Disqualifying (DQ)' },
    ],
  },
  {
    id: 'scenario-filter-fs',
    key: 'filingStatus',
    label: 'Filing Status',
    options: [
      { value: '', label: 'All' },
      { value: 'single', label: 'Single' },
      { value: 'hoh', label: 'Head of Household' },
      { value: 'qss', label: 'Qualifying Surviving Spouse' },
      { value: 'mfs', label: 'Married Filing Separately' },
    ],
  },
  {
    id: 'scenario-filter-marital',
    key: 'marital',
    label: 'Marital Status (HOH)',
    groupId: 'scenario-filter-marital-group',
    showFor: { filter: 'scenario-filter-fs', values: ['', 'hoh'] },
    options: [
      { value: '', label: 'All' },
      { value: 'married', label: 'Married' },
      { value: 'unmarried', label: 'Unmarried' },
    ],
  },
  {
    id: 'scenario-filter-income',
    key: 'incomeBand',
    label: 'Income Band',
    options: [
      { value: '', label: 'All' },
      { value: 'low', label: 'Low (~$17K–$19K)' },
      { value: 'mid-low', label: 'Mid-Low (~$46K–$51K)' },
      { value: 'mid-high', label: 'Mid-High (~$52K–$58K)' },
      { value: 'high', label: 'High (~$59K–$62K)' },
      { value: 'none', label: 'No income in filename' },
    ],
  },
  {
    id: 'scenario-filter-qc',
    key: 'qcCount',
    label: 'Qualifying Children',
    options: [
      { value: '', label: 'All' },
      { value: '0', label: '0' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
    ],
  },
]

/**
 * Inject the EITC scenario-filter dropdowns into a <taxpert-audit-panel>'s Scenarios tab.
 * @param {HTMLElement} panel the <taxpert-audit-panel> element
 */
export function registerScenarioFilters (panel) {
  panel?.registerScenarioFilters?.(SCENARIO_FILTER_FIELDS, parseScenarioFilename)
}
