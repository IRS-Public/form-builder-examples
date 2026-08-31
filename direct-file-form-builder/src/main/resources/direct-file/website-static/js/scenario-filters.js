// Direct File's scenario-filter vocabulary: the three dropdowns above the Scenario picker's list.
//
// The corpus is 161 backend scenarios (`make export-scenarios`), which is enough that a flat list is
// not browsable. Three dimensions are legible in upstream's own names — who is filing, what the
// scenario is about, and which suite it came from — and this file reads them.
//
// Duplicated in fact-explorer as src/model/scenarios/direct-file-{filters,filename}.js, the same way
// credit-assistant's EITC vocabulary is: the two surfaces are different bundles in different
// repositories, taxpert ships the modal but not any app's vocabulary, and a scenario picker is
// offered on both. Keep the two in step; if a third consumer appears, that is the moment to move it
// rather than copy it again.

// The honest limit, stated once here and once in fact-explorer's copy: this reads the name, not the
// return. 73 of the 161 names say nothing about filing status and 78 name no topic, so both
// dimensions carry an explicit "not named" value rather than quietly matching everything. Deriving
// them from the facts would be exact, and would mean shipping a generated dimension map beside the
// corpus — worth doing if these filters get used enough for the gap to annoy anyone.

/** Filing statuses, as Direct File writes them in a scenario name. */
const FILING_STATUSES = ['mfj', 'mfs', 'single', 'hoh', 'qss']

/**
 * Topic → the name fragments that mean it. Ordered, so the label list and this stay in step.
 * Matched against the whole name rather than token-by-token, because upstream writes both
 * `1099r` and `1099_r`, and `dep_care` spans a separator.
 */
const TOPICS = [
  ['retirement', ['1099r', '1099_r']],
  ['ctc', ['ctc', 'odc']],
  ['eitc', ['eitc', '8862']],
  ['cdcc', ['cdcc', 'dep_care', 'depcare']],
  ['hsa', ['hsa']],
  ['savers', ['savers']],
  ['edc', ['edc']],
  ['ptc', ['ptc', '1095a', '1095_a']],
  ['jobs', ['w2', 'withholding']],
  ['apf', ['apf', 'alaska']],
  ['interest', ['1099int', '1099_int', 'interest']],
]

/**
 * Where the scenario came from, in precedence order. `general` is the rest, and it is most of them.
 *
 * `mef` comes before `ats` because every one of the nine names carrying it reads `mef_ats_*`, so the
 * two would otherwise collapse into ATS and the MeF set would be unreachable. They are kept apart on
 * purpose: the MeF ATS scenarios are the ones subject-matter experts ask for by name, and "the ATS
 * scenarios that go through MeF" is a different question from "the ATS scenarios".
 */
const SUITES = ['mef', 'ats', 'ticket', 'cfa']

/**
 * @param {string} filename e.g. "mfj_savers_both_spouses.json"
 * @returns {{filingStatus: string, topics: string[], suite: string}}
 */
export function parseScenarioFilename (filename) {
  const name = filename.replace(/\.json$/, '')
  const tokens = name.split('_')

  const filingStatus = FILING_STATUSES.find((status) => tokens.includes(status)) ?? 'unnamed'

  const topics = TOPICS.filter(([, fragments]) => fragments.some((f) => name.includes(f))).map(([id]) => id)

  const suite = SUITES.find((s) => tokens.includes(s)) ?? 'general'

  // `topics` is the many-valued dimension the scenario modal supports: 12 of the 161 scenarios are
  // about two things, and filtering to either should find them.
  return { filingStatus, topics: topics.length > 0 ? topics : ['none'], suite }
}

export const SCENARIO_FILTER_FIELDS = [
  {
    id: 'scenario-filter-fs',
    key: 'filingStatus',
    label: 'Filing status',
    options: [
      { value: '', label: 'All' },
      { value: 'mfj', label: 'Married filing jointly' },
      { value: 'single', label: 'Single' },
      { value: 'hoh', label: 'Head of household' },
      { value: 'mfs', label: 'Married filing separately' },
      { value: 'qss', label: 'Qualifying surviving spouse' },
      { value: 'unnamed', label: 'Not named in the file' },
    ],
  },
  {
    id: 'scenario-filter-topic',
    key: 'topics',
    label: 'Topic',
    options: [
      { value: '', label: 'All' },
      { value: 'retirement', label: 'Retirement (1099-R)' },
      { value: 'ctc', label: 'Child Tax Credit / ODC' },
      { value: 'eitc', label: 'Earned Income Tax Credit' },
      { value: 'cdcc', label: 'Child & Dependent Care Credit' },
      { value: 'hsa', label: 'Health Savings Account' },
      { value: 'savers', label: "Saver's Credit" },
      { value: 'edc', label: 'Elderly & Disabled Credit' },
      { value: 'ptc', label: 'Premium Tax Credit' },
      { value: 'jobs', label: 'Jobs (W-2, withholding)' },
      { value: 'apf', label: 'Alaska Permanent Fund' },
      { value: 'interest', label: 'Interest' },
      { value: 'none', label: 'No topic in the file' },
    ],
  },
  {
    id: 'scenario-filter-suite',
    key: 'suite',
    label: 'Source',
    options: [
      { value: '', label: 'All' },
      { value: 'mef', label: 'MeF ATS' },
      { value: 'ats', label: 'ATS' },
      { value: 'ticket', label: 'Ticket repro' },
      { value: 'cfa', label: 'CFA' },
      { value: 'general', label: 'General' },
    ],
  },
]

/**
 * Inject the Direct File scenario-filter dropdowns into a <taxpert-audit-panel>'s Scenario modal.
 * @param {HTMLElement} panel the <taxpert-audit-panel> element
 */
export function registerScenarioFilters (panel) {
  panel?.registerScenarioFilters?.(SCENARIO_FILTER_FIELDS, parseScenarioFilename)
}
