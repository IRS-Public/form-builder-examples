// Fact-dictionary XML loader for the audit panel. Ported from credit-assistant; the
// hard-coded fetch path is now supplied by the caller (the panel's `fact-dictionary-url`
// attribute) so the component is host-agnostic. makeCollectionIdPath is imported from the
// shared canonical source and re-exported so existing consumers of this module keep working.
import { makeCollectionIdPath } from '../../shared/js/collection-utils.js'
export { makeCollectionIdPath }

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
 * Lazily fetch + parse the fact dictionary XML exactly once (memoized: concurrent and repeat
 * calls share the same fetch). Invoked from enable() so that — per ADR-004 — production page
 * loads with audit mode OFF never fetch the dictionary.
 * @param {string} url the fact-dictionary.xml URL (from the panel's fact-dictionary-url attribute)
 * @returns {Promise<Document>} the parsed fact-dictionary XML document
 */
export function loadFactDictionaryXml (url) {
  if (!factDictionaryXmlPromise) {
    factDictionaryXmlPromise = fetch(url)
      .then((res) => res.text())
      .then((text) => {
        factDictionaryXml = parser.parseFromString(text, 'application/xml')
        return factDictionaryXml
      })
  }
  return factDictionaryXmlPromise
}
