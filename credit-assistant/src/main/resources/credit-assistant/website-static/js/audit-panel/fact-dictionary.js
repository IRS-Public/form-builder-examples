const parser = new DOMParser()
export const XML_SERIALIZER = new XMLSerializer()

/**
 * The parsed fact-dictionary.xml Document. `null` until `loadFactDictionaryXml()` resolves
 * (called from the audit panel's enable()). Consumers read it as a live binding.
 * @type {Document | null}
 */
export let factDictionaryXml = null

let factDictionaryXmlPromise = null

/**
 * Lazily fetch + parse fact-dictionary.xml exactly once (memoized: concurrent and repeat calls
 * share the same fetch). Invoked from enable() so that — per ADR-004 — production page loads
 * with audit mode OFF never fetch the dictionary.
 * @returns {Promise<Document>} the parsed fact-dictionary XML document
 */
export function loadFactDictionaryXml () {
  if (!factDictionaryXmlPromise) {
    factDictionaryXmlPromise = fetch('/app/eitc/resources/fact-dictionary.xml')
      .then((res) => res.text())
      .then((text) => {
        factDictionaryXml = parser.parseFromString(text, 'application/xml')
        return factDictionaryXml
      })
  }
  return factDictionaryXmlPromise
}

/**
 * Substitute a collection item's concrete id into an abstract collection path, e.g.
 * `("/familyAndHousehold/*\/firstName", "abc")` → `/familyAndHousehold/#abc/firstName`.
 * @param {string} abstractPath the abstract path containing a `*` collection wildcard
 * @param {string} id the collection item id to splice in
 * @returns {string} the concrete path
 */
// NOTE: duplicated in fg-collection-utils.js / fg-set; keep the two in sync when you touch one.
export function makeCollectionIdPath (abstractPath, id) {
  return abstractPath.replace('*', `#${id}`)
}
