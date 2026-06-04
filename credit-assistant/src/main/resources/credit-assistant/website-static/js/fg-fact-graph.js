import * as fg from '../vendor/fact-graph/factgraph-3.1.0.js'

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
// When this page is embedded same-origin in Formative Studio (via its Vite
// proxy), Studio and the questionnaire share the serialized fact graph over a
// BroadcastChannel. Publishing here lets Studio's scenario overlay update live as
// the user answers questions; subscribing lets a scenario loaded in Studio
// rehydrate this page. No-ops everywhere BroadcastChannel is unavailable.
const FG_CHANNEL = 'taxpert:factGraph'
let fgBridge = null
let fgLastSynced = null
try {
  if (typeof BroadcastChannel !== 'undefined') {
    fgBridge = new BroadcastChannel(FG_CHANNEL)
    fgBridge.addEventListener('message', (ev) => {
      const data = ev?.data
      if (!data || data.type !== 'factGraph' || typeof data.graph !== 'string') return
      // Ignore the echo of a graph we just published, and no-op if unchanged.
      if (data.graph === fgLastSynced || data.graph === sessionStorage.getItem('factGraph')) return
      fgLastSynced = data.graph
      sessionStorage.setItem('factGraph', data.graph)
      window.location.reload()
    })
  }
} catch (e) {
  console.warn('factGraph bridge unavailable:', e)
}

export function saveFactGraph () {
  const serialized = factGraph.toJSON()
  sessionStorage.setItem('factGraph', serialized)
  if (fgBridge && serialized !== fgLastSynced) {
    fgLastSynced = serialized
    fgBridge.postMessage({ type: 'factGraph', graph: serialized })
  }
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
