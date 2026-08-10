// The audit panel's Eligibility Inspector: two flat lists of fact paths, each with a status swatch.
//
// It used to open with five hand-maintained arrays of fact paths — the same twenty-three paths, in
// the same five groups, that taxpert's Outcome tracker also carried, kept in step by hand
// across two files. Both now read the one list: the tracker through `config.determinations`, and
// this by reading that configuration back. taxpert-config.html supplies it (translated), from the
// structure in ../taxpert/eitc-graph.js.
//
// So the mapping from a determination to a dashboard is the only thing left here that is about
// *these* lists rather than about rendering:
//
//   determination.dashboard === 'filing-status'    → the Filing Status Dashboard
//   determination.dashboard === 'disqualification' → the Disqualification Dashboard
//
// and within a determination, one section is one heading with its facts under it. A section's own
// `rollupPath` is the fact that group concludes with, drawn with the `ap-dq-rollup` treatment.

import { getConfig } from '../../vendor/taxpert/shared/js/config.js'
import { outcomeText } from '../../vendor/taxpert/shared/js/outcome-kinds.js'

/** The determinations belonging to one of the two dashboards, in configured order. */
function determinationsFor (dashboard) {
  return getConfig().determinations.filter((d) => d.dashboard === dashboard)
}

// The port answers null for a path it has no opinion about — no graph yet, or a path the dictionary
// has dropped — so only reading the value itself can still throw.
function valueOf (fact) {
  try {
    return fact.get.toString()
  } catch {
    return null
  }
}

function renderDashboardSection (facts, rollupPath, heading, getStatus) {
  const items = facts
    .map((p) => {
      let status = 'incomplete'
      let badge = 'incomplete'
      const fact = getConfig().graph.get(p)
      const val = fact?.complete ? valueOf(fact) : null
      if (val !== null) {
        if (getStatus) {
          const result = getStatus(p, val, fact.get)
          status = result.status
          badge = result.badge ?? result.status
        } else {
          status = p.startsWith('/isDisqualified')
            ? val === 'true'
              ? 'disqualified'
              : 'passed'
            : val === 'true'
              ? 'passed'
              : 'failed'
          badge = status
        }
      }
      const isRollup = p === rollupPath
      return `<li class="ap-dq-item ap-dq-${status}${isRollup ? ' ap-dq-rollup' : ''}" title="${p}">
        <span class="ap-dq-label">${p}</span>
        <span class="ap-dq-badge ap-dq-badge--${status}">${badge}</span>
      </li>`
    })
    .join('')
  return `<li class="ap-dq-section-heading">${heading}</li>${items}`
}

/**
 * Every section of every determination in `dashboard`, as the list markup.
 *
 * A determination's own rollup is a settled *answer* rather than a passed/failed test, so it is
 * spoken with that determination's `outcome` — the same words the Outcome tracker's summary shows,
 * translated the same way — instead of the true/false badge the tests around it get. Both surfaces
 * go through outcomeText() so neither has to know whether `outcome` is a descriptor or a function,
 * nor repeat the fall-back-to-the-formatted-value rule.
 */
function renderDashboard (dashboard) {
  return determinationsFor(dashboard)
    .flatMap((determination) => {
      const speakOutcome = (path, val, raw) =>
        path === determination.rollupPath && val !== 'true' && val !== 'false'
          ? { status: 'resolved', badge: outcomeText(determination.outcome, raw, val) }
          : { status: val === 'true' ? 'passed' : 'failed' }

      return determination.sections.map((section) =>
        renderDashboardSection(
          section.facts,
          section.rollupPath ?? determination.rollupPath,
          section.heading,
          dashboard === 'filing-status' ? speakOutcome : null
        )
      )
    })
    .join('')
}

function renderInto (selector, dashboard) {
  const list = document.querySelector(selector)
  if (!list) return
  list.innerHTML = renderDashboard(dashboard)
}

/**
 * Re-render both eligibility dashboards (filing-status and disqualifier) from the live fact graph.
 * Wired to `fg-update`/`fg-load` so the panels stay in sync as answers change, and to
 * `taxpert:config-changed` because the fact paths themselves now arrive from the configuration.
 */
function renderEligibilityDashboard () {
  renderInto('#fs-dashboard-list-nested', 'filing-status')
  renderInto('#dq-dashboard-list-nested', 'disqualification')
}

document.addEventListener('fg-update', () => {
  renderEligibilityDashboard()
})
document.addEventListener('fg-load', () => {
  renderEligibilityDashboard()
})
document.addEventListener('taxpert:config-changed', () => {
  renderEligibilityDashboard()
})

// Exported so eligibility-dashboard-plugin.js can render once after building the section markup.
export { renderEligibilityDashboard }
