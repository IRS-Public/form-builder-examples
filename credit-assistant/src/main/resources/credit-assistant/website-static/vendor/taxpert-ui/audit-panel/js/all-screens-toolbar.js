// <taxpert-screens-toolbar> — the toolbar chrome for the Experience Explorer's two screen-listing
// destinations, Browse All and Path Mode.
//
// A framework-agnostic light-DOM custom element (matching taxpert-global-nav). It names the current
// destination, renders the layout checkbox and the per-section tab strip, persists their state to
// sessionStorage under 'allScreens', and drives the host page: it toggles the body layout classes,
// shows/hides sections, and (in Path Mode, given a host-supplied checkConditionFn) hides the
// single-question screens the user wouldn't reach. The "force collections to render / expand all
// details" bootstrap that manipulates core flow elements stays in the host
// (all-screens-bootstrap.js).
//
// Browse All and Path Mode are separate destinations in the global nav, not a checkbox on one
// page — the mode comes from the URL (`?mode=path`), never from a control in this toolbar, so
// switching modes is a navigation. Hosts that serve the two from genuinely different routes can
// set the `mode` property instead.
//
// Public API
//   Properties:
//     sections        — [{ slug, title }] rendered as section tabs (like taxpert-global-nav's menu)
//     mode            — 'browse' | 'path'; defaults to currentMode() (read from the URL)
//     checkConditionFn — (conditionPath, operator) => boolean; the host passes CA's core
//                        checkCondition. Unset → the Path Mode gate-eval no-ops with a warning.
//   Events (bubble + composed): section-select {slug}, layout-change {horizontal}

const STORAGE_KEY = 'allScreens'

const DEFAULTS = {
  section: '',
  horizontalLayout: true,
  scenarioFilename: '',
}

const MODES = {
  browse: {
    navId: 'browse-all',
    title: 'Browse All',
    description: 'Every screen in the flow, unconditionally.',
  },
  path: {
    navId: 'path-mode',
    title: 'Path Mode',
    description: "Only the screens this Fact Graph's answers actually lead to.",
  },
}

// The Experience Explorer destination the current URL asks for. Exported so hosts can align other
// chrome with it (credit-assistant uses it to set the global nav's active item).
export function currentMode (search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get('mode') === 'path' ? 'path' : 'browse'
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
    this._mode = null // property override; falls back to the URL
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

  get mode () {
    return this._mode ?? currentMode()
  }

  set mode (value) {
    this._mode = Object.hasOwn(MODES, value) ? value : null
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

  // Path Mode: re-evaluate each single-question screen's gating condition against the loaded
  // Fact Graph, hiding screens the user wouldn't reach. Multi-question screens have no gating
  // condition and are always shown; their inner [condition] elements are hidden by the `.hidden`
  // class that toggling body.path-mode activates. Needs the host's checkCondition.
  _applyMode (mode) {
    const enabled = mode === 'path'
    document.body.classList.toggle('path-mode', enabled)

    if (enabled && !this._checkConditionFn) {
      if (!this._warnedNoCheckCondition) {
        console.warn('taxpert-screens-toolbar: Path Mode gate evaluation skipped — set checkConditionFn to enable it.')
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

    const mode = MODES[this.mode]

    // A <header> rather than role="toolbar": it leads with the destination's <h1>, so it names
    // the page as much as it holds its controls.
    const toolbar = el('header', 'all-screens__toolbar')

    const inner = el('div', 'all-screens__toolbar-inner')
    inner.appendChild(this._pageTitle(mode))
    const group = el('div', 'all-screens__toolbar-group')
    group.setAttribute('role', 'toolbar')
    group.setAttribute('aria-label', `${mode.title} options`)
    group.appendChild(this._checkbox('all-screens-toggle-layout', 'Horizontal layout'))
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

  // The destination's identity. Browse All and Path Mode are separate places, so each says which
  // one you're on rather than leaving the difference to a checked box.
  _pageTitle (mode) {
    const wrap = el('div', 'all-screens__mode')
    const title = el('h1', 'all-screens__mode-title')
    title.textContent = mode.title
    const description = el('p', 'all-screens__mode-description')
    description.textContent = mode.description
    wrap.append(title, description)
    return wrap
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
    const sectionTabs = this.querySelectorAll('.all-screens__section-tab')
    const mode = this.mode

    // Give fg-components a tick to materialize collection instances before we open details and
    // render condition annotations. (The host bootstrap sets disallowempty on the collections.)
    setTimeout(() => {
      this._expandAllDetails()
      const stored = readStorage()
      if (layoutToggle) layoutToggle.checked = stored.horizontalLayout
      this._applyLayout(stored.horizontalLayout)
      this._applyMode(mode)
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

    // Re-evaluate gated screens as the user edits answers directly on this page.
    this._fgUpdateHandler = () => this._applyMode(mode)
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
