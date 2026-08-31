// The one piece of starting state Direct File's backend provides and a static port has nobody to
// provide: the `/filers` collection, holding the primary filer.
//
// `/primaryFiler` is not a fact you can write. It is `<Find path="/filers"><Dependency
// path="isPrimaryFiler"/></Find>` — a lookup that only resolves once some item of `/filers` is
// flagged. Upstream, `setupFactGraph` seeds that item before the taxpayer sees a screen, which is
// why no Direct File flow page ever creates it and why the transpiler has none to port. Against an
// empty collection the engine cannot name a home for `/filers/?/firstName`, and every read, write
// and delete through `/primaryFiler/...` — 47 of the flow's questions, starting with the first name
// on the first real screen — throws `requirement failed`.
//
// Exactly one item, flagged primary and nothing more. `isSecondaryFiler` is derived as "not the
// filer that Find returns", so a lone seeded item is primary and not secondary, which is what a
// return with no spouse means. The second filer belongs to the joint-filing path and is not seeded
// here: creating it up front would assert a spouse the taxpayer has not claimed.
//
// Imported ahead of the runtime in fg-components.js, and that order is the whole point — see the
// note there.

import { factGraph, saveFactGraph } from '../vendor/form-builder/flow-runtime/js/fg-fact-graph.js'
import { generateUUID } from '../vendor/form-builder/flow-runtime/js/fg-collection-utils.js'

// Only on a graph that has none. A returning session rehydrates from sessionStorage with its filer
// already in place, and re-seeding would add a second one — which the dictionary would read as a
// spouse.
if (factGraph.getCollectionIds('/filers').length === 0) {
  const primaryFilerId = generateUUID()
  factGraph.addToCollection('/filers', primaryFilerId)
  factGraph.set(`/filers/#${primaryFilerId}/isPrimaryFiler`, true)
  saveFactGraph()
}
