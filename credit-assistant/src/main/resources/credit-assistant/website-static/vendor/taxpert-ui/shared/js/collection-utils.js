// Canonical collection-path helper for the Taxpert product.
//
// A collection fact's abstract path carries a `*` wildcard (e.g.
// `/familyAndHousehold/*/firstName`). Splicing a concrete collection-item id in
// its place yields the fact graph's concrete path. This lived duplicated in
// credit-assistant's core `fg-collection-utils.js` and the audit panel's
// `fact-dictionary.js`; this module is the single source both now import.

/**
 * Substitute a collection item's concrete id into an abstract collection path, e.g.
 * `("/familyAndHousehold/*\/firstName", "abc")` → `/familyAndHousehold/#abc/firstName`.
 * @param {string} abstractPath the abstract path containing a `*` collection wildcard
 * @param {string} id the collection item id to splice in
 * @returns {string} the concrete path
 */
export function makeCollectionIdPath (abstractPath, id) {
  return abstractPath.replace('*', `#${id}`)
}
