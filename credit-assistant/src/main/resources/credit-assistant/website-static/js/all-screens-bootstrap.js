// Credit-assistant bootstrap for the /all-screens debug view. The toolbar chrome + its
// layout/scenario-view/section state now live in the shared <taxpert-screens-toolbar>; this file
// keeps the pieces that manipulate core flow elements (forcing every collection to render, which
// the toolbar's "expand all details" then opens) and hands the toolbar the two host dependencies
// it can't own: CA's checkCondition (for the scenario-view gate evaluation) and the section list
// (derived from the server-rendered section cards on the page).
import { checkCondition } from './fg-conditions.js'

// Force every collection to render its first child instance, even with an empty fact graph, so the
// all-screens view shows collection questions. (Was the first line of the old initAllScreens.)
document.querySelectorAll('fg-collection').forEach((c) => c.setAttribute('disallowempty', 'true'))

const toolbar = document.querySelector('#screens-toolbar')
if (toolbar) {
  // Section tabs, derived from the server-rendered section cards (slug + heading text).
  toolbar.sections = Array.from(document.querySelectorAll('main .all-screens__section')).map(
    (section) => ({
      slug: section.dataset.section,
      title:
        section.querySelector('.all-screens__section-header h2')?.textContent?.trim() ??
        section.dataset.section,
    })
  )
  // The scenario-view toggle needs CA's core condition evaluator to hide unreachable screens.
  toolbar.checkConditionFn = checkCondition
}
