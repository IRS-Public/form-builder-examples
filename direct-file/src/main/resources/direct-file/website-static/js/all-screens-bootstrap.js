// Bootstrap for the generated "Browse All Screens" page (an --allScreens build).
//
// The toolbar chrome and its layout/section state live in the shared <taxpert-screens-toolbar>.
// What stays here is the two things the toolbar cannot own: the section list, which is derived from
// the server-rendered section cards, and this app's condition evaluator, which the toolbar needs to
// decide what would be on-screen.

import { checkCondition } from '../vendor/form-builder/flow-runtime/js/fg-conditions.js'

// Every collection renders its first item even against an empty fact graph, so collection questions
// appear in a listing whose whole point is that nothing has been answered.
document.querySelectorAll('fg-collection').forEach((collection) => {
  collection.setAttribute('disallowempty', 'true')
})

const toolbar = document.querySelector('#screens-toolbar')
if (toolbar) {
  toolbar.sections = Array.from(document.querySelectorAll('main .all-screens__section')).map(
    (section) => ({
      slug: section.dataset.section,
      title:
        section.querySelector('.all-screens__section-header h2')?.textContent?.trim() ??
        section.dataset.section,
    })
  )
  toolbar.checkConditionFn = checkCondition
}
