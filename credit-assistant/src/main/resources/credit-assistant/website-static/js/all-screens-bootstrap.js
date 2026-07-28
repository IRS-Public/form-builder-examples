// Credit-assistant bootstrap for the generated page behind the Experience Explorer's two screen
// listings, Browse All and Path Mode (`?mode=path`). The toolbar chrome + its layout/section state
// live in the shared <taxpert-screens-toolbar>; this file keeps the pieces that manipulate core
// flow elements (forcing every collection to render, which the toolbar's "expand all details" then
// opens) and hands the toolbar the two host dependencies it can't own: CA's checkCondition (for the
// Path Mode gate evaluation) and the section list (derived from the server-rendered section cards).
import { checkCondition } from './fg-conditions.js'
import { currentMode } from '../../../../../../../../../../app/eitc/resources/vendor/taxpert-ui/audit-panel/js/all-screens-toolbar.js'

// One generated page serves both destinations, so the server can't know which one this is: name
// the right one in the tab title and point the global nav's "you are here" checkmark at it.
const isPathMode = currentMode() === 'path'
document.title = isPathMode ? 'Path Mode' : 'All Screens'
// Through the property, not setAttribute: the nav reads its attributes once on connect (no
// attributeChangedCallback) and the setter is what re-points the checkmark.
const nav = document.querySelector('taxpert-global-nav')
if (nav) nav.active = isPathMode ? 'path-mode' : 'browse-all'

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
  // Path Mode needs CA's core condition evaluator to hide unreachable screens.
  toolbar.checkConditionFn = checkCondition
}
