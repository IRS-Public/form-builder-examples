// Formative Studio live-sync bridge, relocated out of credit-assistant's core fg-fact-graph.js.
//
// When the credit-assistant questionnaire is embedded same-origin in Formative Studio (via its
// Vite proxy), the two surfaces share the serialized fact graph over a BroadcastChannel:
// publishing here lets Studio's scenario overlay update live as the user answers questions, and
// inbound messages let a scenario loaded in Studio rehydrate the questionnaire.
//
// HARD COMPATIBILITY CONSTRAINT: the channel name `taxpert:factGraph` and the message shape
// `{ type: 'factGraph', graph: <string> }` must stay byte-for-byte identical —
// formative-studio/src/model/bridge.js implements the other side of this exact protocol.
//
// Feature-detected so it no-ops (and stays node-testable) where BroadcastChannel is unavailable.

const DEFAULT_CHANNEL_NAME = 'taxpert:factGraph'

/**
 * Create a fact-graph bridge.
 * @param {object} [opts]
 * @param {string} [opts.channelName='taxpert:factGraph'] BroadcastChannel name (keep the default).
 * @param {(serializedGraphJSON: string) => void} [opts.onRemoteGraph] called with an inbound graph
 *        (echoes of graphs this bridge just published are already filtered out).
 * @returns {{ publish(serializedGraphJSON: string): void }}
 */
export function createFactGraphBridge ({ channelName = DEFAULT_CHANNEL_NAME, onRemoteGraph } = {}) {
  let channel = null
  // The last graph seen on the wire (published or received), so we ignore the echo of a graph we
  // just published and don't re-broadcast a graph we just received.
  let lastSynced = null

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(channelName)
      channel.addEventListener('message', (ev) => {
        const data = ev?.data
        if (!data || data.type !== 'factGraph' || typeof data.graph !== 'string') return
        if (data.graph === lastSynced) return // ignore our own echo / no-op if unchanged
        lastSynced = data.graph
        onRemoteGraph?.(data.graph)
      })
    }
  } catch (e) {
    console.warn('factGraph bridge unavailable:', e)
  }

  return {
    publish (serializedGraphJSON) {
      if (!channel || typeof serializedGraphJSON !== 'string') return
      if (serializedGraphJSON === lastSynced) return
      lastSynced = serializedGraphJSON
      channel.postMessage({ type: 'factGraph', graph: serializedGraphJSON })
    },
  }
}
