import * as fg from '../vendor/fact-graph/factgraph-3.1.0.js'
import { createFactGraphBridge } from '../vendor/taxpert-ui/audit-panel/js/fg-graph-bridge.js'

const res = await fetch('/app/eitc/resources/fact-dictionary.xml')
const text = await res.text()
export const factDictionary = fg.FactDictionaryFactory.importFromXml(text)

const serializedGraphJSON = sessionStorage.getItem('factGraph')
export let factGraph = serializedGraphJSON
  ? fg.GraphFactory.fromJSON(factDictionary, serializedGraphJSON)
  : fg.GraphFactory.apply(factDictionary)

window.factGraph = factGraph
document.dispatchEvent(new CustomEvent('fg-load'))

// Presence of an unload event listener will disable bfcache in Firefox.
window.addEventListener('unload', () => {})

// ── Formative Studio live-sync bridge (additive, feature-detected) ─────────────
// When this page is embedded same-origin in Formative Studio (via its Vite proxy), Studio and the
// questionnaire share the serialized fact graph over a BroadcastChannel. Publishing lets Studio's
// scenario overlay update live as the user answers questions; the onRemoteGraph callback lets a
// scenario loaded in Studio rehydrate this page. The bridge (channel name + message shape) lives in
// @taxpert/ui; it feature-detects BroadcastChannel and suppresses the echo of graphs we publish.
const fgBridge = createFactGraphBridge({
  onRemoteGraph: (graph) => {
    // No-op if this graph is already the active one; otherwise adopt it and reload.
    if (graph === sessionStorage.getItem('factGraph')) return
    sessionStorage.setItem('factGraph', graph)
    window.location.reload()
  },
})

export function saveFactGraph () {
  const serialized = factGraph.toJSON()
  sessionStorage.setItem('factGraph', serialized)
  fgBridge.publish(serialized)
}

export function loadFactGraph (factGraphAsString) {
  factGraph = fg.GraphFactory.fromJSON(factDictionary, factGraphAsString)
  saveFactGraph()
  // Defer the reload one task so the BroadcastChannel publish in saveFactGraph()
  // is flushed to other same-origin surfaces (e.g. Formative Studio's overlay)
  // before this frame begins unloading. An immediate reload races the in-flight
  // message and drops it — which is why answering a question syncs but loading a
  // scenario did not.
  setTimeout(() => window.location.reload(), 0)
}
window.loadFactGraph = loadFactGraph

export function resetEntireGraphKeepingTaxYear (newYearValue) {
  sessionStorage.removeItem('factGraph')
  factGraph = fg.GraphFactory.apply(factDictionary)
  window.factGraph = factGraph
  factGraph.set('/chosenTaxYear', newYearValue)
  saveFactGraph()
  window.location.reload()
}
