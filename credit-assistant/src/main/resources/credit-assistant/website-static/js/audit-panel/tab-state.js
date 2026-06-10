// Shared UI state for the audit panel's tab rail. `lastActiveTabButton` is written by
// FactLink (audited-fact.js) when it programmatically activates the fact-graph tab, and
// read/written by the panel shell (panel-shell.js) when opening/closing tabs. It lives in
// its own module so both can share it without a circular import.
let lastActiveTabButton = null

export function getLastActiveTabButton () {
  return lastActiveTabButton
}

export function setLastActiveTabButton (button) {
  lastActiveTabButton = button
}
