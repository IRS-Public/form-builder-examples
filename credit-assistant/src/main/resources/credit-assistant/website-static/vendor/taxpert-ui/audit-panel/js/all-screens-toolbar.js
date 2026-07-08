// <taxpert-screens-toolbar> — the toolbar chrome for the /all-screens debug view.
//
// A framework-agnostic light-DOM custom element (matching taxpert-global-nav). It renders the
// layout / scenario-view checkboxes and the per-section tab strip, persists their state to
// sessionStorage under 'allScreens', and drives the host page: it toggles the body layout classes,
// shows/hides sections, and (given a host-supplied checkConditionFn) hides the single-question
// screens the user wouldn't reach. The "force collections to render / expand all details"
// bootstrap that manipulates core flow elements stays in the host (all-screens-bootstrap.js).
//
// Public API
//   Properties:
//     sections        — [{ slug, title }] rendered as section tabs (like taxpert-global-nav's menu)
//     checkConditionFn — (conditionPath, operator) => boolean; the host passes CA's core
//                        checkCondition. Unset → the scenario-view gate-eval no-ops with a warning.
//   Events (bubble + composed): section-select {slug}, layout-change {horizontal},
//     scenario-view-change {enabled}

const STORAGE_KEY = 'allScreens'

const DEFAULTS = {
  section: '',
  horizontalLayout: true,
  scenarioView: true,
  scenarioFilename: '',
}

function el (tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function readStorage () {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch (e) {
    return { ...DEFAULTS }
  }
}

function writeStorage (patch) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStorage(), ...patch }))
}

class TaxpertScreensToolbar extends HTMLElement {
  constructor () {
    super()
    this._sections = []
    this._checkConditionFn = null
    this._warnedNoCheckCondition = false
    this._rendered = false
    // Stored so re-render (connect → sections-set) can detach the previous listener rather than
    // leaking one bound to a now-removed toggle.
    this._fgUpdateHandler = null
  }

  connectedCallback () {
    this.render()
  }

  get sections () {
    return this._sections
  }

  set sections (value) {
    this._sections = Array.isArray(value) ? value : []
    if (this.isConnected) this.render()
  }

  get checkConditionFn () {
    return this._checkConditionFn
  }

  set checkConditionFn (fn) {
    this._checkConditionFn = typeof fn === 'function' ? fn : null
  }

  _emit (name, detail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }))
  }

  // ── Host-page effects ────────────────────────────────────────────────────────

  _expandAllDetails () {
    document.querySelectorAll('details').forEach((d) => d.setAttribute('open', 'true'))
  }

  // Show only the section matching `slug`. Empty slug means show every section.
  _showSection (slug) {
    document.querySelectorAll('main .all-screens__section').forEach((section) => {
      section.hidden = !!slug && section.dataset.section !== slug
    })
  }

  _applyLayout (horizontal) {
    document.body.classList.toggle('layout--horizontal', horizontal)
  }

  // Scenario View: re-evaluate each single-question screen's gating condition against the loaded
  // Fact Graph, hiding screens the user wouldn't reach. Multi-question screens have no gating
  // condition and are always shown; their inner [condition] elements are hidden by the `.hidden`
  // class that toggling body.scenario-view activates. Needs the host's checkCondition.
  _applyScenarioView (enabled) {
    document.body.classList.toggle('scenario-view', enabled)

    if (enabled && !this._checkConditionFn) {
      if (!this._warnedNoCheckCondition) {
        console.warn('taxpert-screens-toolbar: scenario-view gate evaluation skipped — set checkConditionFn to enable it.')
        this._warnedNoCheckCondition = true
      }
      return
    }

    document.querySelectorAll('.screen[data-gate-condition]').forEach((screen) => {
      const condition = screen.dataset.gateCondition
      const operator = screen.dataset.gateOperator
      screen.hidden = enabled && !this._checkConditionFn(condition, operator)
    })
  }

  // ── Render + wire ────────────────────────────────────────────────────────────

  render () {
    this.textContent = ''

    const toolbar = el('div', 'all-screens__toolbar')
    toolbar.setAttribute('role', 'toolbar')
    toolbar.setAttribute('aria-label', 'Audit toolbar')

    const inner = el('div', 'all-screens__toolbar-inner')
    const group = el('div', 'all-screens__toolbar-group')
    group.appendChild(this._checkbox('all-screens-toggle-layout', 'Horizontal layout'))
    group.appendChild(this._checkbox('all-screens-toggle-scenario-view', 'Scenario view'))
    inner.appendChild(group)
    toolbar.appendChild(inner)

    const nav = el('nav', 'all-screens__section-tabs')
    nav.setAttribute('aria-label', 'Section')
    const allTab = el('button', 'all-screens__section-tab all-screens__section-tab--active')
    allTab.type = 'button'
    allTab.dataset.section = ''
    allTab.textContent = 'All sections'
    nav.appendChild(allTab)
    for (const section of this._sections) {
      const tab = el('button', 'all-screens__section-tab')
      tab.type = 'button'
      tab.dataset.section = section.slug
      tab.textContent = section.title
      nav.appendChild(tab)
    }
    toolbar.appendChild(nav)

    this.appendChild(toolbar)
    this._rendered = true
    this._init()
  }

  _checkbox (id, label) {
    const wrap = el('div', 'usa-checkbox')
    const input = el('input', 'usa-checkbox__input')
    input.id = id
    input.type = 'checkbox'
    input.checked = true
    const lbl = el('label', 'usa-checkbox__label')
    lbl.htmlFor = id
    lbl.textContent = label
    wrap.append(input, lbl)
    return wrap
  }

  _init () {
    // Detach the fg-update listener from any previous render before wiring the fresh controls.
    if (this._fgUpdateHandler) {
      document.removeEventListener('fg-update', this._fgUpdateHandler)
      this._fgUpdateHandler = null
    }

    const layoutToggle = this.querySelector('#all-screens-toggle-layout')
    const scenarioViewToggle = this.querySelector('#all-screens-toggle-scenario-view')
    const sectionTabs = this.querySelectorAll('.all-screens__section-tab')

    // Give fg-components a tick to materialize collection instances before we open details and
    // render condition annotations. (The host bootstrap sets disallowempty on the collections.)
    setTimeout(() => {
      this._expandAllDetails()
      const stored = readStorage()
      if (layoutToggle) layoutToggle.checked = stored.horizontalLayout
      this._applyLayout(stored.horizontalLayout)
      if (scenarioViewToggle) scenarioViewToggle.checked = stored.scenarioView
      this._applyScenarioView(stored.scenarioView)
    }, 100)

    const stored = readStorage()
    sectionTabs.forEach((tab) => {
      tab.classList.toggle('all-screens__section-tab--active', tab.dataset.section === stored.section)
    })
    this._showSection(stored.section)

    layoutToggle?.addEventListener('change', () => {
      writeStorage({ horizontalLayout: layoutToggle.checked })
      this._applyLayout(layoutToggle.checked)
      this._emit('layout-change', { horizontal: layoutToggle.checked })
    })

    scenarioViewToggle?.addEventListener('change', () => {
      writeStorage({ scenarioView: scenarioViewToggle.checked })
      this._applyScenarioView(scenarioViewToggle.checked)
      this._emit('scenario-view-change', { enabled: scenarioViewToggle.checked })
    })

    // Re-evaluate gated screens as the user edits answers directly on this page.
    this._fgUpdateHandler = () => this._applyScenarioView(scenarioViewToggle?.checked ?? false)
    document.addEventListener('fg-update', this._fgUpdateHandler)

    sectionTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        sectionTabs.forEach((t) => t.classList.remove('all-screens__section-tab--active'))
        tab.classList.add('all-screens__section-tab--active')
        const slug = tab.dataset.section
        writeStorage({ section: slug })
        this._showSection(slug)
        if (slug) document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        this._emit('section-select', { slug })
      })
    })
  }
}

customElements.define('taxpert-screens-toolbar', TaxpertScreensToolbar)

export { TaxpertScreensToolbar }
