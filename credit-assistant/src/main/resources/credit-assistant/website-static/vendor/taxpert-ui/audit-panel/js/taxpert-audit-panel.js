// <taxpert-audit-panel> — the shared Taxpert audit / debug panel.
//
// A framework-agnostic vanilla custom element (light DOM, no shadow root), matching the
// <taxpert-global-nav> precedent. It self-renders the entire panel (resizer + content sections +
// tab rail) that credit-assistant previously server-rendered as ~8 Thymeleaf fragments, so a host
// only drops in a thin `<taxpert-audit-panel …>` mount. The panel DOM keeps the original ids and
// class names, so the ported section modules' document-scoped queries and the ported CSS keep
// working unchanged.
//
// Public API
//   Attributes: api-base (default http://localhost:8000), scenarios-base, fact-dictionary-url,
//               ai-mode-default
//   Instance methods:
//     enable() / disable()                     — reveal / hide audit mode (the workspace toggle)
//     openTab(dataTab) / closePanel()          — open a section / collapse to the rail
//     trackFact(path, collectionId, setFocus)  — add a fact to the Fact Inspector
//     registerSection(descriptor)              — add a host-owned section (e.g. Eligibility)
//     registerScenarioFilters(fields, parse)   — inject host filter dropdowns into Scenarios
//   Module-level enable(panelEl?) / disable(panelEl?) default to the single
//     document.querySelector('taxpert-audit-panel') and back window.enableAuditMode/disableAuditMode.
//
// The Fact Inspector / condition tracing live in the imported side-effect modules below (they
// register <fact-link>, <audited-fact>, <condition-detail> and expose window.* console helpers).

import { BUILT_IN_SECTIONS } from './sections.js'
import {
  getAuditPanelStorage,
  setAuditPanelStorage,
  AUDIT_PANEL_STORAGE_KEY,
} from './storage.js'
import { getLastActiveTabButton, setLastActiveTabButton } from './tab-state.js'
import { loadFactDictionaryXml, factDictionaryXml } from './fact-dictionary.js'
import { trackFact as trackFactImpl, setFactOptions } from './audited-fact.js'
import { displayConditions, hideConditions } from './condition-detail.js'
import { applyFlags, initFeatureFlagsSection } from './feature-flags.js'
import { initChat } from './chat.js'
import {
  loadScenarioFromAuditPanel,
  generateScenarioFromPrompt,
  renderGeneratedScenarioResult,
  clearGeneratedScenario,
} from './fact-graph-io.js'

const AUDIT_PANEL_DEFAULT_WIDTH = 38
const AUDIT_PANEL_MIN_WIDTH = 320
const AUDIT_PANEL_MAX_WIDTH_RATIO = 0.7
const AUDIT_PANEL_KEYBOARD_STEP = 24
const ICON_BASE = '/app/eitc/resources/vendor/uswds-3.13.0/img/usa-icons'

function el (tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

class TaxpertAuditPanel extends HTMLElement {
  constructor () {
    super()
    this._sections = BUILT_IN_SECTIONS.map((s) => ({ ...s }))
    this._scenarioFilters = null
    this._scenarioOptionsHtml = ''
    this._rendered = false
    this._syncWidth = () => {}
  }

  connectedCallback () {
    if (this._rendered) return
    // Capture host-supplied scenario <option>s before we wipe the light DOM. The host wraps them
    // in a <template> (keeps the page HTML valid — bare <option>s aren't valid page content); we
    // also accept direct <option> children as a convenience.
    const tpl = this.querySelector('template')
    const opts = (tpl ? tpl.content : this).querySelectorAll('option')
    if (opts.length) {
      this._scenarioOptionsHtml = Array.from(opts)
        .map((o) => o.outerHTML)
        .join('')
    }
    this.render()
  }

  // ── ctx passed to section render() callbacks ────────────────────────────────
  get _sectionContext () {
    // Rebuilt on each access so factDictionaryXml reflects the live (post-load) binding.
    return {
      factGraph: () => window.factGraph,
      factDictionaryXml,
      trackFact: (path, collectionId, setFocus) =>
        this.trackFact(path, collectionId, setFocus),
    }
  }

  // ── Public registration API ─────────────────────────────────────────────────

  /**
   * Register a host-owned section. Descriptor: { sectionId, dataTab, label, title, order,
   * wrapperClass?, ff?, eager?, render(container, ctx) | buildBody(container) }.
   */
  registerSection (descriptor) {
    if (!descriptor || !descriptor.dataTab) return
    // Replace any existing section with the same dataTab, else insert by order.
    const existingIdx = this._sections.findIndex((s) => s.dataTab === descriptor.dataTab)
    if (existingIdx !== -1) this._sections.splice(existingIdx, 1)
    this._sections.push(descriptor)
    this._sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    if (this._rendered) this._renderSections() // rebuild content + rail to place it in order
  }

  /**
   * Inject host filter dropdowns into the Scenarios tab. `fields` is an array of
   * { id, key, label, options:[{value,label}], showFor?:{ filter, values } }; `parseFilename`
   * maps a scenario filename to an object keyed by each field's `key`.
   */
  registerScenarioFilters (fields, parseFilename) {
    this._scenarioFilters = { fields: fields ?? [], parseFilename }
    if (this._rendered) this._renderScenarioFilters()
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    this.classList.add('audit-panel', 'hidden')
    this.setAttribute('aria-label', 'Audit Panel')

    this.textContent = ''

    // Resizer handle
    const resizer = el('div', 'audit-panel__resizer')
    resizer.id = 'audit-panel-resizer'
    resizer.setAttribute('role', 'separator')
    resizer.setAttribute('aria-controls', this.id || 'audit-panel')
    resizer.setAttribute('aria-label', 'Resize audit panel')
    resizer.setAttribute('aria-orientation', 'vertical')
    resizer.setAttribute('aria-valuemin', '320')
    resizer.setAttribute('aria-valuemax', '960')
    resizer.tabIndex = 0
    this.appendChild(resizer)

    // Content pane + rail are (re)built together
    this._content = el('div', 'audit-panel__content')
    this._rail = el('nav', 'audit-panel__rail')
    this._rail.setAttribute('aria-label', 'Audit panel sections')
    this.appendChild(this._content)
    this.appendChild(this._rail)

    this._rendered = true
    this._renderSections()
    this._renderScenarioFilters()
  }

  // Build every section body + the rail tab list from the ordered section descriptors.
  _renderSections () {
    this._content.textContent = ''
    this._rail.textContent = ''

    const ul = el('ul')
    ul.setAttribute('role', 'tablist')
    ul.setAttribute('aria-orientation', 'vertical')

    // Toggle (collapse/expand) button — always first.
    const toggleLi = el('li')
    toggleLi.setAttribute('role', 'presentation')
    const toggleBtn = el('button', 'audit-panel__tab audit-panel__tab--toggle')
    toggleBtn.id = 'toggle-audit-panel'
    toggleBtn.type = 'button'
    toggleBtn.setAttribute('aria-label', 'Toggle audit panel')
    toggleBtn.title = 'Toggle audit panel'
    toggleBtn.innerHTML = `<img src="${ICON_BASE}/navigate_far_before.svg" alt="Toggle audit panel" class="usa-icon" />`
    toggleLi.appendChild(toggleBtn)
    ul.appendChild(toggleLi)

    const scenariosAvailable = this._scenarioOptionsHtml.length > 0

    for (const section of this._sections) {
      // Section body
      const sectionDiv = el('div', `audit-panel__section${section.wrapperClass ? ' ' + section.wrapperClass : ''}`)
      if (section.sectionId) sectionDiv.id = section.sectionId
      sectionDiv.dataset.tab = section.dataTab
      if (typeof section.render === 'function') section.render(sectionDiv, this._sectionContext)
      else if (typeof section.buildBody === 'function') section.buildBody(sectionDiv)
      // The Scenarios tab/section only appear when the host supplied scenarios.
      if (section.dataTab === 'scenarios' && !scenariosAvailable) sectionDiv.hidden = true
      this._content.appendChild(sectionDiv)

      // Rail tab
      const li = el('li')
      li.setAttribute('role', 'presentation')
      if (section.dataTab === 'scenarios' && !scenariosAvailable) li.hidden = true
      const btn = el('button', 'audit-panel__tab')
      btn.setAttribute('role', 'tab')
      btn.dataset.tab = section.dataTab
      btn.setAttribute('aria-controls', section.sectionId || '')
      btn.setAttribute('aria-selected', 'false')
      btn.type = 'button'
      btn.title = section.title || section.label
      btn.innerHTML =
        `<span class="audit-panel__tab-label" aria-hidden="true">${section.label}</span>` +
        `<span class="usa-sr-only">${section.title || section.label}</span>`
      li.appendChild(btn)
      ul.appendChild(li)
    }

    this._rail.appendChild(ul)

    // Move host-supplied scenario <option>s into the freshly-built select.
    if (this._scenarioOptionsHtml) {
      const select = this.querySelector('#scenario-select')
      if (select) select.insertAdjacentHTML('beforeend', this._scenarioOptionsHtml)
    }
  }

  // Build the EITC (host) scenario filter dropdowns into the Scenarios tab's .scenario-filters.
  _renderScenarioFilters () {
    if (!this._scenarioFilters) return
    const container = this.querySelector('.scenario-filters')
    if (!container) return
    container.textContent = ''

    for (const field of this._scenarioFilters.fields) {
      const group = el('div', 'usa-form-group')
      if (field.groupId) group.id = field.groupId
      const label = el('label', 'usa-label')
      label.htmlFor = field.id
      label.textContent = field.label
      const select = el('select', 'usa-select')
      select.id = field.id
      select.innerHTML = field.options
        .map((o) => `<option value="${o.value}">${o.label}</option>`)
        .join('')
      select.addEventListener('change', () => this._filterScenarios())
      group.append(label, select)
      container.appendChild(group)
    }
  }

  // Generic scenario filtering: the panel owns the loop; the host owns the vocabulary
  // (field descriptors + parseFilename). Mirrors CA's former filterScenarios().
  _filterScenarios () {
    if (!this._scenarioFilters) return
    const { fields, parseFilename } = this._scenarioFilters
    const values = {}
    for (const field of fields) {
      values[field.id] = this.querySelector(`#${field.id}`)?.value ?? ''
    }

    // Show/hide any field group whose visibility depends on another field's value.
    for (const field of fields) {
      if (!field.showFor || !field.groupId) continue
      const group = this.querySelector(`#${field.groupId}`)
      if (group) group.hidden = !field.showFor.values.includes(values[field.showFor.filter])
    }

    const select = this.querySelector('#scenario-select')
    if (!select) return
    for (const option of select.options) {
      if (!option.value) continue
      const parsed = parseFilename(option.value)
      option.hidden = fields.some((field) => {
        const v = values[field.id]
        return v && parsed[field.key] !== v
      })
    }
    const selectedOption = select.options[select.selectedIndex]
    if (selectedOption && selectedOption.hidden) select.value = ''
  }

  // ── Tabs / open-close ────────────────────────────────────────────────────────

  _updateToggleButtonIcon (isOpen) {
    const toggleBtn = this.querySelector('#toggle-audit-panel')
    const img = toggleBtn?.querySelector('img')
    if (!img) return
    const iconName = isOpen ? 'navigate_far_next.svg' : 'navigate_far_before.svg'
    img.src = `${ICON_BASE}/${iconName}`
  }

  openTab (tabId) {
    this.dataset.activeTab = tabId
    document.body.classList.add('audit-panel-open')
    this._tabButtons?.forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tabId))
    })
    setAuditPanelStorage('isOpen', true)
    setAuditPanelStorage('activeTab', tabId)
    this._updateToggleButtonIcon(true)
    this._syncWidth()
  }

  closePanel () {
    document.body.classList.remove('audit-panel-open')
    delete this.dataset.activeTab
    this._tabButtons?.forEach((btn) => btn.setAttribute('aria-selected', 'false'))
    setAuditPanelStorage('isOpen', false)
    setAuditPanelStorage('activeTab', null)
    this._updateToggleButtonIcon(false)
    const focusTarget = getLastActiveTabButton() ?? this._tabButtons?.[0]
    focusTarget?.focus()
  }

  trackFact (path, collectionId, setFocus = true) {
    trackFactImpl(path, collectionId, setFocus)
  }

  // ── enable / disable (the workspace toggle) ─────────────────────────────────

  /**
   * Enable audit mode: reveal the panel rail, restore persisted tab/width/tracked-fact state,
   * fetch the fact-dictionary (memoized), and wire up the panel's controls.
   *
   * Listener-teardown contract (unchanged from panel-shell.js): the persistent document keydown /
   * window resize / fg-load listeners added here are NOT removed on disable(). One-time wiring is
   * guarded by the data-*Initialized flags so re-enabling is idempotent, and disable() hides the
   * panel which makes those handlers inert.
   */
  async enable () {
    // Focus hack: keep tracked facts from stealing focus during keyboard nav.
    document.documentElement.tabIndex = -1
    document.documentElement.focus()
    document.documentElement.addEventListener(
      'focusout',
      () => document.documentElement.removeAttribute('tabindex'),
      { once: true }
    )

    // Reveal the panel (thin rail). The toggled stylesheet + `hidden` class both gate visibility.
    const styles = document.querySelector('#audit-panel-styles')
    if (styles) styles.disabled = false
    this.classList.remove('hidden')

    // ADR-004: fetch the fact-dictionary only once audit mode is enabled (memoized).
    await loadFactDictionaryXml(this.getAttribute('fact-dictionary-url'))

    const resizer = this.querySelector('#audit-panel-resizer')
    this._tabButtons = this.querySelectorAll('.audit-panel__tab[role="tab"]')

    this._syncWidth = this._setupWidthControls(resizer)
    this._syncWidth()

    // Wire tab rail + close button + keyboard handler (idempotent).
    if (this.dataset.visibilityControlsInitialized !== 'true') {
      const toggleBtn = this.querySelector('#toggle-audit-panel')
      toggleBtn?.addEventListener('click', () => {
        if (document.body.classList.contains('audit-panel-open')) {
          this.closePanel()
        } else {
          const tabId = getLastActiveTabButton()?.dataset.tab ?? this._tabButtons[0]?.dataset.tab
          if (tabId) this.openTab(tabId)
        }
      })

      this._tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const tabId = btn.dataset.tab
          setLastActiveTabButton(btn)
          const isAlreadyActive =
            this.dataset.activeTab === tabId &&
            document.body.classList.contains('audit-panel-open')
          if (isAlreadyActive) this.closePanel()
          else this.openTab(tabId)
        })
      })

      document.addEventListener('keydown', (event) => this._handleKeydown(event))
      this.dataset.visibilityControlsInitialized = 'true'
    }

    // Feature flags: apply runtime state (show/hide Explain tab) + wire the checkboxes.
    // Must run after visibility controls and before restoring the active tab.
    applyFlags()
    initFeatureFlagsSection()
    initChat()

    // Restore previously open tab state.
    const savedStorage = getAuditPanelStorage()
    if (savedStorage.isOpen) {
      const savedTab = savedStorage.activeTab
      if (savedTab) {
        this.openTab(savedTab)
      } else {
        document.body.classList.add('audit-panel-open')
        this._updateToggleButtonIcon(true)
      }
    } else {
      this._updateToggleButtonIcon(false)
    }

    // Restore tracked facts from session storage.
    const storage = getAuditPanelStorage()
    if (storage.trackedFacts) {
      for (const fact of storage.trackedFacts) {
        this.trackFact(fact.path, fact.collectionId, false)
      }
    }

    // Cross-cutting exception (documented): wrap every <fg-show> on the page in a <fact-link>.
    // This intentionally reaches OUTSIDE the panel into the host's flow DOM, so it stays a
    // document-scoped pass (unwound in disable()).
    const fgShows = document.querySelectorAll('fg-show')
    for (const fgShow of fgShows) {
      const factLink = document.createElement('fact-link')
      factLink.setAttribute('path', fgShow.path)
      factLink.append(fgShow.cloneNode())
      fgShow.parentElement.replaceChild(factLink, fgShow)
    }

    // Load fact paths once the fact graph is available.
    if (!window.factGraph) {
      document.addEventListener('fg-load', setFactOptions)
    } else {
      setFactOptions()
    }

    // Show-conditions toggle.
    const conditionsCheckbox = this.querySelector('#show-conditions')
    conditionsCheckbox.addEventListener('change', () => {
      setAuditPanelStorage('showConditions', conditionsCheckbox.checked)
      if (conditionsCheckbox.checked) displayConditions()
      else hideConditions()
    })
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

    // Scenario controls.
    this.querySelector('#load-scenario-btn')?.addEventListener('click', loadScenarioFromAuditPanel)
    this.querySelector('#generate-scenario-btn')?.addEventListener('click', generateScenarioFromPrompt)
    this.querySelector('#all-screens-clear-scenario')?.addEventListener('click', clearGeneratedScenario)
    // Re-surface the description + Download button after loadFactGraph()'s page reload.
    renderGeneratedScenarioResult()
  }

  /**
   * Disable audit mode: hide the panel, drop open/active-tab state, clear audit-panel session
   * storage, hide injected condition chips, and unwrap the fact-link wrappers added in enable().
   */
  disable () {
    const styles = document.querySelector('#audit-panel-styles')
    if (styles) styles.disabled = true
    this.classList.add('hidden')
    document.body.classList.remove('audit-panel-open')
    document.body.removeAttribute('style')
    delete this.dataset.activeTab
    this.querySelectorAll('.audit-panel__tab[role="tab"]').forEach((btn) =>
      btn.setAttribute('aria-selected', 'false')
    )
    sessionStorage.removeItem(AUDIT_PANEL_STORAGE_KEY)
    hideConditions()

    // Unwrap the fact-link wrappers added to <fg-show>s in enable().
    const fgShows = document.querySelectorAll('fg-show')
    for (const fgShow of fgShows) {
      const link = fgShow.parentElement
      link.parentElement.replaceChild(fgShow, link)
    }
  }

  // Keyboard handler: Escape closes the panel; arrow keys navigate the rail.
  _handleKeydown (event) {
    if (event.key === 'Escape' && document.body.classList.contains('audit-panel-open')) {
      event.preventDefault()
      this.closePanel()
      return
    }
    if (!event.target.matches?.('.audit-panel__tab')) return
    const tabs = Array.from(this._tabButtons)
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

  // Adjustable-width controls (pointer drag + arrow keys), persisted to session storage.
  // Returns a syncWidth() that restores the stored (or default) width. Ported from panel-shell.js.
  _setupWidthControls (resizer) {
    if (this.dataset.widthControlsInitialized === 'true' && typeof this._syncWidthFn === 'function') {
      return this._syncWidthFn
    }

    const panel = this

    const getMax = () =>
      Math.max(AUDIT_PANEL_MIN_WIDTH, Math.floor(window.innerWidth * AUDIT_PANEL_MAX_WIDTH_RATIO))
    const clamp = (width) => Math.min(Math.max(width, AUDIT_PANEL_MIN_WIDTH), getMax())

    const updateResizerA11y = (width) => {
      if (!resizer) return
      resizer.setAttribute('aria-valuemin', String(AUDIT_PANEL_MIN_WIDTH))
      resizer.setAttribute('aria-valuemax', String(getMax()))
      resizer.setAttribute('aria-valuenow', String(width))
      resizer.setAttribute('aria-valuetext', `${width}px wide`)
    }

    const applyWidth = (width, persist = true) => {
      const next = clamp(width)
      document.documentElement.style.setProperty('--audit-panel-width', `${next}px`)
      updateResizerA11y(next)
      if (persist) setAuditPanelStorage('width', next)
      return next
    }

    const applyDefaultWidth = () => {
      document.documentElement.style.setProperty('--audit-panel-width', `${AUDIT_PANEL_DEFAULT_WIDTH}vw`)
      const fallbackWidth = Math.round((window.innerWidth * AUDIT_PANEL_DEFAULT_WIDTH) / 100)
      const isOpen = document.body.classList.contains('audit-panel-open')
      const renderedWidth = isOpen
        ? Math.round(panel.getBoundingClientRect().width) || fallbackWidth
        : fallbackWidth
      updateResizerA11y(clamp(renderedWidth))
    }

    const resizeBy = (delta) => {
      const current = Math.round(panel.getBoundingClientRect().width)
      return applyWidth(current + delta)
    }

    const onResizeKeydown = (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        resizeBy(-AUDIT_PANEL_KEYBOARD_STEP)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        resizeBy(AUDIT_PANEL_KEYBOARD_STEP)
      }
    }

    const onPointerDown = (event) => {
      if (event.button !== 0 || !resizer) return
      event.preventDefault()
      resizer.setPointerCapture(event.pointerId)
      document.body.classList.add('audit-panel-resizing')
      const onMove = (moveEvent) => applyWidth(window.innerWidth - moveEvent.clientX)
      const onUp = () => {
        resizer.releasePointerCapture(event.pointerId)
        document.body.classList.remove('audit-panel-resizing')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    const syncWidth = () => {
      const storage = getAuditPanelStorage()
      if (typeof storage.width === 'number') applyWidth(storage.width)
      else applyDefaultWidth()
    }

    resizer?.addEventListener('pointerdown', onPointerDown)
    resizer?.addEventListener('keydown', onResizeKeydown)
    window.addEventListener('resize', syncWidth)

    this.dataset.widthControlsInitialized = 'true'
    this._syncWidthFn = syncWidth
    return syncWidth
  }
}

customElements.define('taxpert-audit-panel', TaxpertAuditPanel)

// Module-level enable/disable default to the single panel on the page, preserving
// window.enableAuditMode/disableAuditMode and today's `import { enable } from '…'` call sites.
export function enable (panelEl) {
  const panel = panelEl || document.querySelector('taxpert-audit-panel')
  return panel?.enable()
}

export function disable (panelEl) {
  const panel = panelEl || document.querySelector('taxpert-audit-panel')
  return panel?.disable()
}

window.enableAuditMode = enable
window.disableAuditMode = disable

export { TaxpertAuditPanel }
