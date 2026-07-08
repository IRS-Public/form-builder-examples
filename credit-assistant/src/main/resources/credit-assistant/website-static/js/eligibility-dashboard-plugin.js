// Credit-assistant-owned plugin that registers the EITC Eligibility dashboard into the shared
// <taxpert-audit-panel>. The dashboard's DQ/FS fact-path lists and rendering live in the
// (unchanged) ./audit-panel/eligibility-dashboard.js, which also keeps its own fg-update/fg-load
// listeners; this file only ports the former eligibility-section.html static markup as a
// DOM-building function and wires it in via the panel's registerSection() extension point.
import { renderEligibilityDashboard } from './audit-panel/eligibility-dashboard.js'

// Inner markup of the former fragments/audit-panel/eligibility-section.html (the wrapper
// <div class="audit-panel__section" id="audit-panel-eligibility-section" data-tab="…"> is added
// by the panel from the descriptor below).
const ELIGIBILITY_SECTION_HTML = `
  <h2>Eligibility Inspector</h2>
  <div class="audit-panel__section ap-details" id="fs-dashboard-nested">
    <h3>Filing Status Dashboard</h3>
    <div class="audit-panel__section">
      <p class="ap-hint">Tracks inputs to
        <code>/derivedFilingStatus</code>.
        <span class="dq-ok-swatch"></span> = true,
        <span class="dq-dq-swatch"></span> = false,
        <span class="dq-inc-swatch"></span> = incomplete.
      </p>
      <ul id="fs-dashboard-list-nested" class="ap-dq-list"></ul>
    </div>
  </div>
  <div class="audit-panel__section ap-details" id="dq-dashboard-nested">
    <h3>Disqualification Dashboard</h3>
    <div class="audit-panel__section">
      <p class="ap-hint">Tracks various filing status tests and disqualifications.
        <span class="dq-ok-swatch"></span> = not disqualified,
        <span class="dq-dq-swatch"></span> = disqualified,
        <span class="dq-inc-swatch"></span> = incomplete.
      </p>
      <ul id="dq-dashboard-list-nested" class="ap-dq-list"></ul>
    </div>
  </div>`

/**
 * Register the Eligibility section into a <taxpert-audit-panel>. `eager: true` so the dashboard
 * lists exist as soon as the panel renders (matching the old always-present server-rendered
 * markup), letting the eligibility-dashboard.js fg-load/fg-update listeners populate them.
 * @param {HTMLElement} panel the <taxpert-audit-panel> element
 */
export function registerEligibilityDashboard (panel) {
  if (!panel?.registerSection) return
  panel.registerSection({
    sectionId: 'audit-panel-eligibility-section',
    dataTab: 'eligibility-dashboard',
    label: 'Eligibility',
    title: 'Eligibility Dashboard',
    order: 40,
    eager: true,
    render (container) {
      container.innerHTML = ELIGIBILITY_SECTION_HTML
      // Populate immediately from the current graph (if any); ongoing updates come from
      // eligibility-dashboard.js's own fg-update/fg-load listeners.
      renderEligibilityDashboard()
    },
  })
}
