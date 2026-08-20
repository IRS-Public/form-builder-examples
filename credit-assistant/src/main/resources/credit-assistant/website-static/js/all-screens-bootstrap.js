// Credit-assistant bootstrap for the generated page behind the Experience Explorer's two screen
// listings, Browse All and Path Mode (`?mode=path`).
//
// The toolbar chrome, the mode, the nav's "you are here" checkmark and the tab title all live in
// the shared <taxpert-screens-toolbar>. What stays here is the two things the toolbar cannot own:
// this app's condition evaluator, which Path Mode needs to decide what would be on screen, and the
// section list, derived from the server-rendered section cards.
import { checkCondition } from '../vendor/form-builder/flow-runtime/js/fg-conditions.js'

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
