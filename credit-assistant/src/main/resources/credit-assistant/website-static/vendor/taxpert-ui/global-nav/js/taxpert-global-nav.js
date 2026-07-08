// <taxpert-global-nav> — the shared Taxpert app-switcher header.
//
// A framework-agnostic vanilla custom element (light DOM, no shadow root) so it
// renders natively in credit-assistant (no build tools) and inside React/Vite in
// Formative Studio. Renders a waffle button + breadcrumb, and a dropdown with the
// TAXPERT WORKSPACE toggle and the navigation taxonomy.
//
// Public API
//   Attributes: app, active, workspace-label, workspace-on ("true"/"false"),
//               menu-json (JSON string override)
//   Property:   menu (array override; wins over menu-json and the default)
//   Events (bubbles + composed):
//     nav-select     detail:{ id, href, action } — cancelable; a host may
//                    preventDefault() to intercept and handle in-app. Items with
//                    an href otherwise navigate natively.
//     workspace-toggle detail:{ on }
//
// See nav-menu-data.js for the taxonomy and helpers.

import { DEFAULT_MENU, breadcrumbFor, contextLabel } from './nav-menu-data.js'

function el(tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function waffleIcon() {
  const grid = el('span', 'tgn-waffle__grid')
  grid.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 9; i++) grid.appendChild(el('span', 'tgn-waffle__dot'))
  return grid
}

class TaxpertGlobalNav extends HTMLElement {
  static get observedAttributes() {
    return ['active', 'workspace-on', 'workspace-label', 'app', 'menu-json']
  }

  constructor() {
    super()
    this._open = false
    this._menu = null // property override
    this._collapsed = new Set() // group ids the user has collapsed
    this._onDocClick = (event) => {
      if (this._open && !this.contains(event.target)) this._close()
    }
    this._onKeydown = (event) => {
      if (event.key === 'Escape' && this._open) {
        this._close()
        this._button?.focus()
      }
    }
  }

  connectedCallback() {
    document.addEventListener('click', this._onDocClick)
    document.addEventListener('keydown', this._onKeydown)
    this.render()
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._onDocClick)
    document.removeEventListener('keydown', this._onKeydown)
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render()
  }

  // --- public property API ---

  get menu() {
    if (this._menu) return this._menu
    const json = this.getAttribute('menu-json')
    if (json) {
      try {
        return JSON.parse(json)
      } catch (error) {
        console.warn('taxpert-global-nav: invalid menu-json attribute', error)
      }
    }
    return DEFAULT_MENU
  }

  set menu(value) {
    this._menu = value
    if (this.isConnected) this.render()
  }

  get workspaceOn() {
    return this.getAttribute('workspace-on') === 'true'
  }

  // --- interaction ---

  _toggle() {
    this._open ? this._close() : this._openMenu()
  }

  _openMenu() {
    this._open = true
    this.render()
  }

  _close() {
    if (!this._open) return
    this._open = false
    this.render()
  }

  _toggleGroup(groupId) {
    if (this._collapsed.has(groupId)) this._collapsed.delete(groupId)
    else this._collapsed.add(groupId)
    this.render()
  }

  _toggleWorkspace() {
    const next = !this.workspaceOn
    // Self-set so the visual state persists across re-renders; hosts sync via the event.
    this.setAttribute('workspace-on', String(next))
    this.dispatchEvent(
      new CustomEvent('workspace-toggle', {
        bubbles: true,
        composed: true,
        detail: { on: next },
      }),
    )
  }

  _onItemClick(event, item) {
    if (item.disabled) {
      event.preventDefault()
      return
    }
    const selectEvent = new CustomEvent('nav-select', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: { id: item.id, href: item.href, action: item.action },
    })
    const proceed = this.dispatchEvent(selectEvent)
    // A host cancelled it, or the item is an explicit in-app action → don't navigate.
    if (!proceed || item.action) event.preventDefault()
    this._close()
  }

  // --- rendering ---

  render() {
    const menu = this.menu
    const active = this.getAttribute('active')

    this.textContent = ''
    this.classList.add('tgn-host')

    const bar = el('nav', 'tgn-bar')
    bar.setAttribute('aria-label', 'Taxpert workspace')

    const button = el('button', 'tgn-waffle')
    button.type = 'button'
    button.setAttribute('aria-haspopup', 'true')
    button.setAttribute('aria-expanded', String(this._open))
    button.setAttribute('aria-label', 'Open Taxpert workspace menu')
    button.classList.toggle('tgn-waffle--active', this._open)
    button.appendChild(waffleIcon())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      this._toggle()
    })
    this._button = button
    bar.appendChild(button)

    bar.appendChild(this._renderBreadcrumb(active, menu))

    if (this._open) bar.appendChild(this._renderDropdown(menu, active))

    this.appendChild(bar)
  }

  _renderBreadcrumb(active, menu) {
    const crumb = el('span', 'tgn-breadcrumb')
    const root = el('span', 'tgn-breadcrumb__root')
    root.textContent = 'Taxpert'
    crumb.appendChild(root)

    const ctx = contextLabel(active, menu)
    if (ctx) {
      const sep = el('span', 'tgn-breadcrumb__sep')
      sep.textContent = '|'
      sep.setAttribute('aria-hidden', 'true')
      const label = el('span', 'tgn-breadcrumb__ctx')
      label.textContent = ctx
      crumb.append(sep, label)
    }
    // Expose the full string for assistive tech / tests.
    crumb.setAttribute('aria-label', breadcrumbFor(active, menu))
    return crumb
  }

  _renderDropdown(menu, active) {
    const panel = el('div', 'tgn-menu')
    panel.setAttribute('role', 'menu')
    // Clicks inside the menu shouldn't bubble to the document close handler.
    panel.addEventListener('click', (event) => event.stopPropagation())

    panel.appendChild(this._renderWorkspaceRow())

    for (const item of menu) {
      if (item.children?.length) panel.appendChild(this._renderGroup(item, active))
      else panel.appendChild(this._renderLeaf(item, active, false))
    }
    return panel
  }

  _renderWorkspaceRow() {
    const label = this.getAttribute('workspace-label') || 'TAXPERT WORKSPACE'
    const row = el('div', 'tgn-workspace')

    const text = el('span', 'tgn-workspace__label')
    text.textContent = label
    row.appendChild(text)

    const toggle = el('button', 'tgn-toggle')
    toggle.type = 'button'
    toggle.setAttribute('role', 'switch')
    toggle.setAttribute('aria-checked', String(this.workspaceOn))
    toggle.setAttribute('aria-label', label)
    toggle.classList.toggle('tgn-toggle--on', this.workspaceOn)
    toggle.appendChild(el('span', 'tgn-toggle__knob'))
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      this._toggleWorkspace()
    })
    row.appendChild(toggle)

    return row
  }

  _renderGroup(group, active) {
    const wrap = el('div', 'tgn-group')
    const collapsed = this._collapsed.has(group.id)

    const header = el('button', 'tgn-group__header')
    header.type = 'button'
    header.setAttribute('aria-expanded', String(!collapsed))
    header.textContent = group.label
    header.addEventListener('click', (event) => {
      event.stopPropagation()
      this._toggleGroup(group.id)
    })
    wrap.appendChild(header)

    if (!collapsed) {
      const list = el('div', 'tgn-group__items')
      for (const child of group.children) list.appendChild(this._renderLeaf(child, active, true))
      wrap.appendChild(list)
    }
    return wrap
  }

  _renderLeaf(item, active, isSub) {
    const isActive = item.id === active
    const link = el('a', 'tgn-item')
    if (isSub) link.classList.add('tgn-item--sub')
    if (isActive) link.classList.add('tgn-item--active')
    link.setAttribute('role', 'menuitem')

    if (item.disabled) {
      link.classList.add('tgn-item--disabled')
      link.setAttribute('aria-disabled', 'true')
    } else {
      link.href = item.href || '#'
    }

    const label = el('span', 'tgn-item__label')
    label.textContent = item.label
    link.appendChild(label)

    if (isActive) {
      const check = el('span', 'tgn-item__check')
      check.setAttribute('aria-hidden', 'true')
      check.textContent = '✓'
      link.appendChild(check)
    }

    link.addEventListener('click', (event) => this._onItemClick(event, item))
    return link
  }
}

customElements.define('taxpert-global-nav', TaxpertGlobalNav)

export { TaxpertGlobalNav }
