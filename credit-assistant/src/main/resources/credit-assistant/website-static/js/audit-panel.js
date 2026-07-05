// Audit panel entry barrel. Mirrors fg-components.js: imports each submodule for its side
// effects (custom-element registration, fg-update/fg-load listeners, window.* console APIs,
// chat wiring) and re-exports enable/disable so page.html / all-screens.html can keep doing
// `import { enable } from '/app/eitc/resources/js/audit-panel.js'`.
//
// fact-dictionary.js no longer fetches at module-eval time: the fetch is lazy/memoized via
// loadFactDictionaryXml(), called from enable(). The import here remains only so the module evaluates and registers its exports.
import './audit-panel/fact-dictionary.js'
import './audit-panel/storage.js'
import './audit-panel/tab-state.js'
import './audit-panel/eligibility-dashboard.js'
import './audit-panel/condition-detail.js'
import './audit-panel/audited-fact.js'
import './audit-panel/fact-graph-io.js'
import './audit-panel/chat.js'
import './audit-panel/feature-flags.js'
import { enable, disable } from './audit-panel/panel-shell.js'

export { enable, disable }
