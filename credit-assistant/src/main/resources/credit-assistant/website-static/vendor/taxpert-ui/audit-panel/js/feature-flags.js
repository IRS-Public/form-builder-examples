// Runtime feature-flag management for the audit panel. Ported from credit-assistant.
//
// Build-time flags (--aiMode etc.) set the initial default, now carried by the panel's
// `ai-mode-default` attribute (formerly a data-ff-<flag>-default attribute on #audit-panel).
// Runtime overrides are stored in localStorage under FEATURE_FLAGS_KEY so they persist across
// page loads without a rebuild.
//
// Effective value: localStorage override → build-time attribute default.
//
// DOM convention:
//   • Rail tab <li> elements carry data-ff="ai-mode" (kebab of the flag name).
//     The JS toggles their `hidden` attribute to show/hide them.
//   • The #ff-<flagname> checkbox in the Feature Flags section syncs with state.

const FEATURE_FLAGS_KEY = 'taxpert:featureFlags'

function _readOverrides () {
  try {
    return JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function _writeOverrides (overrides) {
  try {
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(overrides))
  } catch { /* storage unavailable */ }
}

// Build-time defaults: read from the panel element's attributes.
function _buildDefaults () {
  const panel = document.querySelector('taxpert-audit-panel')
  return {
    aiMode: panel?.getAttribute('ai-mode-default') === 'true',
  }
}

export function getFlag (name) {
  const overrides = _readOverrides()
  const defaults = _buildDefaults()
  return name in overrides ? overrides[name] : (defaults[name] ?? false)
}

export function setFlag (name, value) {
  const overrides = _readOverrides()
  overrides[name] = Boolean(value)
  _writeOverrides(overrides)
}

// Apply the current flag state to the DOM: shows/hides the Explain rail tab
// and the chat section, keeps the panel from restoring a now-hidden tab.
export function applyFlags () {
  const aiMode = getFlag('aiMode')

  // Rail tab <li data-ff="ai-mode">
  const explainTabLi = document.querySelector('.audit-panel__tab[data-tab="chat-explain"]')?.closest('li')
  if (explainTabLi) explainTabLi.hidden = !aiMode

  // If the panel is currently open on the Explain tab but AI mode was just
  // disabled, close the panel so the user isn't stuck on an invisible section.
  if (!aiMode) {
    const panel = document.querySelector('taxpert-audit-panel')
    if (panel?.dataset.activeTab === 'chat-explain') {
      document.body.classList.remove('audit-panel-open')
      delete panel.dataset.activeTab
      document.querySelectorAll('.audit-panel__tab[role="tab"]').forEach((btn) =>
        btn.setAttribute('aria-selected', 'false')
      )
    }
  }
}

// Wire up the feature-flags section checkboxes and sync their initial state.
// Call once from the panel's enable() after the DOM is ready.
export function initFeatureFlagsSection () {
  const aiCheckbox = document.querySelector('#ff-ai-mode')
  if (!aiCheckbox) return

  // Show current effective value and the build-time default
  aiCheckbox.checked = getFlag('aiMode')
  const defaults = _buildDefaults()
  const hint = document.querySelector('#ff-ai-mode-hint')
  if (hint) hint.textContent = `Build default: ${defaults.aiMode ? 'on' : 'off'}`

  aiCheckbox.addEventListener('change', () => {
    setFlag('aiMode', aiCheckbox.checked)
    applyFlags()
  })
}
