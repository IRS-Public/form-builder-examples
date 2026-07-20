// sessionStorage-backed persistence for the audit panel's open/closed state, tracked
// facts, width, active tab, and show-conditions toggle. Ported verbatim from
// credit-assistant (no DOM access — host-agnostic as-is).
export const AUDIT_PANEL_STORAGE_KEY = 'auditPanel'
const AUDIT_PANEL_STORAGE_FIELDS = new Set([
  'isOpen',
  'trackedFacts',
  'showConditions',
  'width',
  'activeTab',
])

// Save the open/closed state of the audit panel in session storage so it persists across page reloads and forward navigation.
export function getAuditPanelStorage () {
  const storage = sessionStorage.getItem(AUDIT_PANEL_STORAGE_KEY)
  if (storage) {
    return JSON.parse(storage)
  } else {
    return {}
  }
}

// Set a key/value pair in session storage for the audit panel, with special handling to ensure tracked facts are unique by path and collectionId
export function setAuditPanelStorage (key, value) {
  if (!AUDIT_PANEL_STORAGE_FIELDS.has(key)) {
    throw new Error(`Unsupported audit panel storage key: ${key}`)
  }

  const storage = getAuditPanelStorage()
  if (key === 'trackedFacts') {
    const uniqueFacts = []
    const seen = new Set()
    for (const fact of value) {
      const factId = `${fact.path}#${fact.collectionId}`
      if (!seen.has(factId)) {
        uniqueFacts.push(fact)
        seen.add(factId)
      }
    }
    storage.trackedFacts = uniqueFacts
  } else if (key === 'isOpen') {
    storage.isOpen = value
  } else if (key === 'showConditions') {
    storage.showConditions = value
  } else if (key === 'width') {
    storage.width = value
  } else if (key === 'activeTab') {
    storage.activeTab = value
  }
  sessionStorage.setItem(AUDIT_PANEL_STORAGE_KEY, JSON.stringify(storage))
}
