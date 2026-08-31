// The starting state Direct File's backend provides and a static port has nobody to provide: the
// `/filers` collection, holding the primary filer and the slot the spouse goes in.
//
// Neither `/primaryFiler` nor `/secondaryFiler` is a fact you can write. Each is a `<Find>` over
// `/filers` — the first for the item whose `isPrimaryFiler` is true, the second, through the derived
// `isSecondaryFiler`, for the item that is *not* the one that Find returns. Against an empty
// collection neither resolves, and the engine cannot name a home for `/filers/?/firstName`: every
// read, write and delete through them throws `requirement failed`. That is 47 of the flow's
// questions, starting with the first name on the first real screen.
//
// **Two items, not one, and that does not assert a spouse.** Upstream's `setupFactGraph` creates
// both before the taxpayer sees a screen — `CollectionFactory([primaryFilerId, secondaryFilerId])`,
// then `isPrimaryFiler` true on the first and explicitly false on the second — and all 161 scenarios
// in `scenarios/` carry two filers for that reason. Whether there *is* a spouse is decided by
// `/filingStatus` and `/isMarried`, which are writable facts the taxpayer answers; seeding the
// second filer leaves both of them incomplete, exactly as a one-filer graph does. The second item is
// the shape the dictionary expects a return to have, not a claim about who is on it.
//
// Imported ahead of the runtime in fg-components.js, and that order is the whole point — see the
// note there.

import { factGraph, saveFactGraph } from '../vendor/form-builder/flow-runtime/js/fg-fact-graph.js'
import { generateUUID } from '../vendor/form-builder/flow-runtime/js/fg-collection-utils.js'

// Only on a graph that has none. A returning session rehydrates from sessionStorage with its filers
// already in place, and a scenario loaded from the Scenario picker brings upstream's own two — so
// re-seeding either would add a third filer to a return that has room for two.
if (factGraph.getCollectionIds('/filers').length === 0) {
  const primaryFilerId = generateUUID()
  const secondaryFilerId = generateUUID()

  factGraph.addToCollection('/filers', primaryFilerId)
  factGraph.addToCollection('/filers', secondaryFilerId)

  // Both written, neither defaulted. `isSecondaryFiler` is derived as "not the filer Find returns",
  // so the false is what makes the second item resolvable as the spouse rather than ambiguous.
  factGraph.set(`/filers/#${primaryFilerId}/isPrimaryFiler`, true)
  factGraph.set(`/filers/#${secondaryFilerId}/isPrimaryFiler`, false)

  saveFactGraph()
}
