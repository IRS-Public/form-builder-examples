// Bootstrap for the generated page behind the Experience Explorer's two screen listings, Browse All
// and Path Mode (`?mode=path`).
//
// The toolbar chrome, the mode, the nav's "you are here" checkmark and the tab title all live in
// the shared <taxpert-screens-toolbar>. What stays here is the two things the toolbar cannot own:
// this app's condition evaluator, which Path Mode needs to decide what would be on screen, and the
// section list, derived from the server-rendered section cards.
//
// This app had none of it until recently: it shipped a fork of the page template from before any of
// this existed, which rendered a bare, empty document. The template is the scaffold's now and this
// file is the whole of what the page needs from the app.
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
