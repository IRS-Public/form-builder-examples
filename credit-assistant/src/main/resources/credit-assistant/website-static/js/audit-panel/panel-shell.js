import {
  AUDIT_PANEL_STORAGE_KEY,
  getAuditPanelStorage,
  setAuditPanelStorage,
} from './storage.js'
import { displayConditions, hideConditions } from './condition-detail.js'
import { loadFactDictionaryXml } from './fact-dictionary.js'
import { trackFact, setFactOptions } from './audited-fact.js'
import { loadScenarioFromAuditPanel, filterScenarios } from './fact-graph-io.js'
import { getLastActiveTabButton, setLastActiveTabButton } from './tab-state.js'

const auditPanel = document.querySelector('#audit-panel')
const auditPanelResizer = document.querySelector('#audit-panel-resizer')
const AUDIT_PANEL_DEFAULT_WIDTH = 38
const AUDIT_PANEL_MIN_WIDTH = 320
const AUDIT_PANEL_MAX_WIDTH_RATIO = 0.7
const AUDIT_PANEL_KEYBOARD_STEP = 24
const auditPanelTabButtons = document.querySelectorAll('.audit-panel__tab[role="tab"]')

/**
 * Enable audit mode: reveal the panel rail, restore persisted tab/width/tracked-fact state,
 * fetch the fact-dictionary (memoized), and wire up the panel's controls.
 *
 * Listener-teardown contract: the persistent `document` keydown / `window` resize / `fg-load`
 * listeners added here are NOT removed on disable(). Instead one-time wiring is guarded by the
 * `data-widthControlsInitialized` / `data-visibilityControlsInitialized` flags so re-enabling is
 * idempotent, and disable() hides the panel (drops `audit-panel-open` and the `.audit-panel__tab`
 * elements) which makes those handlers inert — they no-op when the panel chrome is gone.
 */
export async function enable () {
  // This focus handling is a bit of a hack, but it ensures that the track facts in the audit panel are not stealing focus when navigating with the keyboard.
  document.documentElement.tabIndex = -1
  document.documentElement.focus()
  document.documentElement.addEventListener(
    'focusout',
    () => {
      document.documentElement.removeAttribute('tabindex')
    },
    { once: true }
  )

  // Set up the audit to display on the page (shows the thin tab rail)
  document.querySelector('#audit-panel-styles').disabled = false
  document.querySelector('#audit-panel').classList.remove('hidden')
  document.querySelector('#taxpert-banner')?.classList.remove('hidden')

  // ADR-004: fetch the fact-dictionary only once audit mode is enabled (memoized).
  // A single await here covers every synchronous factDictionaryXml consumer reached during
  // enable (tracked-fact render() and condition display) via its live binding.
  await loadFactDictionaryXml()

  // Set up adjustable width controls for the audit panel
  function initializeAdjustableWidth () {
    if (!auditPanel) {
      return () => {}
    }

    if (
      auditPanel.dataset.widthControlsInitialized === 'true' &&
      typeof auditPanel.syncAuditPanelWidth === 'function'
    ) {
      return auditPanel.syncAuditPanelWidth
    }

    function getAuditPanelMaxWidth () {
      return Math.max(
        AUDIT_PANEL_MIN_WIDTH,
        Math.floor(window.innerWidth * AUDIT_PANEL_MAX_WIDTH_RATIO)
      )
    }

    function clampAuditPanelWidth (width) {
      return Math.min(
        Math.max(width, AUDIT_PANEL_MIN_WIDTH),
        getAuditPanelMaxWidth()
      )
    }

    function updateAuditPanelResizerAccessibility (width) {
      if (!auditPanelResizer) {
        return
      }

      const maxWidth = getAuditPanelMaxWidth()
      auditPanelResizer.setAttribute(
        'aria-valuemin',
        String(AUDIT_PANEL_MIN_WIDTH)
      )
      auditPanelResizer.setAttribute('aria-valuemax', String(maxWidth))
      auditPanelResizer.setAttribute('aria-valuenow', String(width))
      auditPanelResizer.setAttribute('aria-valuetext', `${width}px wide`)
    }

    function applyAuditPanelWidth (width, persist = true) {
      const nextWidth = clampAuditPanelWidth(width)
      document.documentElement.style.setProperty(
        '--audit-panel-width',
        `${nextWidth}px`
      )
      updateAuditPanelResizerAccessibility(nextWidth)

      if (persist) {
        setAuditPanelStorage('width', nextWidth)
      }

      return nextWidth
    }

    function applyDefaultAuditPanelWidth () {
      document.documentElement.style.setProperty(
        '--audit-panel-width',
        `${AUDIT_PANEL_DEFAULT_WIDTH}vw`
      )
      const fallbackWidth = Math.round(
        (window.innerWidth * AUDIT_PANEL_DEFAULT_WIDTH) / 100
      )
      // Only measure the rendered panel width when content is actually open;
      // in rail-only mode getBoundingClientRect returns only the rail width.
      const isOpen = document.body.classList.contains('audit-panel-open')
      const renderedWidth = isOpen
        ? Math.round(auditPanel.getBoundingClientRect().width) || fallbackWidth
        : fallbackWidth
      updateAuditPanelResizerAccessibility(clampAuditPanelWidth(renderedWidth))
    }

    function resizeAuditPanelBy (delta) {
      const currentWidth = Math.round(auditPanel.getBoundingClientRect().width)
      return applyAuditPanelWidth(currentWidth + delta)
    }

    function handleAuditPanelResizeKeydown (event) {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        resizeAuditPanelBy(-AUDIT_PANEL_KEYBOARD_STEP)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        resizeAuditPanelBy(AUDIT_PANEL_KEYBOARD_STEP)
      }
    }

    function handleAuditPanelResizerPointerDown (event) {
      if (event.button !== 0 || !auditPanelResizer) {
        return
      }

      event.preventDefault()
      auditPanelResizer.setPointerCapture(event.pointerId)
      document.body.classList.add('audit-panel-resizing')

      const handlePointerMove = (moveEvent) => {
        applyAuditPanelWidth(window.innerWidth - moveEvent.clientX)
      }

      const handlePointerUp = () => {
        auditPanelResizer.releasePointerCapture(event.pointerId)
        document.body.classList.remove('audit-panel-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    }

    function syncAuditPanelWidth () {
      const storage = getAuditPanelStorage()
      if (typeof storage.width === 'number') {
        applyAuditPanelWidth(storage.width)
      } else {
        applyDefaultAuditPanelWidth()
      }
    }

    auditPanelResizer?.addEventListener(
      'pointerdown',
      handleAuditPanelResizerPointerDown
    )
    auditPanelResizer?.addEventListener(
      'keydown',
      handleAuditPanelResizeKeydown
    )
    window.addEventListener('resize', syncAuditPanelWidth)

    auditPanel.dataset.widthControlsInitialized = 'true'
    auditPanel.syncAuditPanelWidth = syncAuditPanelWidth

    return syncAuditPanelWidth
  }

  // Initialize the adjustable width controls and sync the width to storage or the default value
  const syncAuditPanelWidth = initializeAdjustableWidth()
  syncAuditPanelWidth()

  // Update the toggle button icon based on whether the panel is open
  function updateToggleButtonIcon (isOpen) {
    const toggleBtn = document.querySelector('#toggle-audit-panel')
    if (!toggleBtn) return
    const img = toggleBtn.querySelector('img')
    if (!img) return
    const iconName = isOpen ? 'navigate_far_next.svg' : 'navigate_far_before.svg'
    img.src = `/app/eitc/resources/vendor/uswds-3.13.0/img/usa-icons/${iconName}`
  }

  // Open the audit panel to a specific tab
  function openTab (tabId) {
    auditPanel.dataset.activeTab = tabId
    document.body.classList.add('audit-panel-open')
    auditPanelTabButtons.forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tabId))
    })
    setAuditPanelStorage('isOpen', true)
    setAuditPanelStorage('activeTab', tabId)
    updateToggleButtonIcon(true)
    syncAuditPanelWidth()
  }

  // Close the audit panel content pane, returning focus to the rail
  function closeAuditPanel () {
    document.body.classList.remove('audit-panel-open')
    delete auditPanel.dataset.activeTab
    auditPanelTabButtons.forEach((btn) =>
      btn.setAttribute('aria-selected', 'false')
    )
    setAuditPanelStorage('isOpen', false)
    setAuditPanelStorage('activeTab', null)
    updateToggleButtonIcon(false)
    const focusTarget = getLastActiveTabButton() ?? auditPanelTabButtons[0]
    focusTarget?.focus()
  }

  // Keyboard handler: Escape closes the panel; arrow keys navigate the rail
  function handleAuditPanelKeydown (event) {
    if (
      event.key === 'Escape' &&
      document.body.classList.contains('audit-panel-open')
    ) {
      event.preventDefault()
      closeAuditPanel()
      return
    }

    if (!event.target.matches('.audit-panel__tab')) return
    const tabs = Array.from(auditPanelTabButtons)
    const idx = tabs.indexOf(event.target)
    if (idx === -1) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      tabs[(idx + 1) % tabs.length].focus()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      tabs[(idx - 1 + tabs.length) % tabs.length].focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      tabs[0].focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      tabs[tabs.length - 1].focus()
    }
  }

  // Wire up tab rail buttons, close button, and keyboard handler
  if (auditPanel?.dataset.visibilityControlsInitialized !== 'true') {
    // Close button at the top of the rail
    const showAuditPanelBtn = document.querySelector('#toggle-audit-panel')
    if (showAuditPanelBtn) {
      showAuditPanelBtn.addEventListener('click', () => {
        if (document.body.classList.contains('audit-panel-open')) {
          closeAuditPanel()
        } else {
          const tabId = getLastActiveTabButton()?.dataset.tab ?? auditPanelTabButtons[0]?.dataset.tab
          if (tabId) openTab(tabId)
        }
      })
    }

    auditPanelTabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab
        setLastActiveTabButton(btn)
        const isAlreadyActive =
          auditPanel.dataset.activeTab === tabId &&
          document.body.classList.contains('audit-panel-open')
        if (isAlreadyActive) {
          closeAuditPanel()
        } else {
          openTab(tabId)
        }
      })
    })

    document.addEventListener('keydown', handleAuditPanelKeydown)
    auditPanel.dataset.visibilityControlsInitialized = 'true'
  }

  // Restore previously open tab state when navigating forward or back
  const savedStorage = getAuditPanelStorage()
  if (savedStorage.isOpen) {
    const savedTab = savedStorage.activeTab
    if (savedTab) {
      openTab(savedTab)
    } else {
      document.body.classList.add('audit-panel-open')
      updateToggleButtonIcon(true)
    }
  } else {
    updateToggleButtonIcon(false)
  }

  // If there are any facts stored in session storage, make sure to add them back
  const storage = getAuditPanelStorage()
  if (storage.trackedFacts) {
    for (const fact of storage.trackedFacts) {
      trackFact(fact.path, fact.collectionId, false)
    }
  }

  // Add links to all the <fg-show>s
  const fgShows = document.querySelectorAll('fg-show')
  for (const fgShow of fgShows) {
    const factLink = document.createElement('fact-link')
    factLink.setAttribute('path', fgShow.path)
    factLink.append(fgShow.cloneNode())
    fgShow.parentElement.replaceChild(factLink, fgShow)
  }

  // Load fact paths once the fact graph is available (if it isn't already)
  if (!window.factGraph) {
    document.addEventListener('fg-load', setFactOptions)
  } else {
    setFactOptions()
  }

  // Set up the show conditions toggle
  const conditionsCheckbox = document.querySelector('#show-conditions')
  conditionsCheckbox.addEventListener('change', () => {
    setAuditPanelStorage('showConditions', conditionsCheckbox.checked)
    if (conditionsCheckbox.checked) {
      displayConditions()
    } else {
      hideConditions()
    }
  })

  // If the user had show conditions toggled on, make sure to show them and set up the listener for new collections added after page load
  if (getAuditPanelStorage().showConditions) {
    conditionsCheckbox.checked = true
    displayConditions()
    document.querySelectorAll('.fg-collection__add-item').forEach((element) => {
      element.addEventListener('click', () => {
        hideConditions()
        displayConditions()
      })
    })
  }

  const loadScenarioBtn = document.querySelector('#load-scenario-btn')
  if (loadScenarioBtn) {
    loadScenarioBtn.addEventListener('click', loadScenarioFromAuditPanel)
  }

  for (const selector of [
    '#scenario-filter-dq',
    '#scenario-filter-fs',
    '#scenario-filter-marital',
    '#scenario-filter-income',
    '#scenario-filter-qc',
  ]) {
    document.querySelector(selector)?.addEventListener('change', filterScenarios)
  }
}

/**
 * Disable audit mode: hide the panel + Taxpert banner, drop the open/active-tab state, clear the
 * audit-panel session storage (tracked facts, width, etc.), hide injected condition chips, and
 * unwrap the `fact-link` wrappers added to `<fg-show>`s in enable(). The persistent listeners from
 * enable() are intentionally left attached but go inert once the panel chrome is hidden.
 */
export function disable () {
  document.querySelector('#audit-panel-styles').disabled = true
  document.querySelector('#audit-panel').classList.add('hidden')
  document.querySelector('#taxpert-banner')?.classList.add('hidden')
  document.body.classList.remove('audit-panel-open')
  document.body.removeAttribute('style')
  delete auditPanel.dataset.activeTab
  auditPanelTabButtons.forEach((btn) =>
    btn.setAttribute('aria-selected', 'false')
  )
  sessionStorage.removeItem(AUDIT_PANEL_STORAGE_KEY)
  hideConditions()

  // Remove links from all the <fg-show>s
  const fgShows = document.querySelectorAll('fg-show')
  for (const fgShow of fgShows) {
    const link = fgShow.parentElement
    link.parentElement.replaceChild(fgShow, link)
  }
}

window.enableAuditMode = enable
window.disableAuditMode = disable
