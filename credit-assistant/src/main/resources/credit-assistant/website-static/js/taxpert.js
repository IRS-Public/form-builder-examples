/*
 * taxpert.js — Taxpert shell initialization (Phase 3)
 *
 * Wires up all chrome interactions:
 *   - Tab switching with sessionStorage persistence
 *   - Rail collapse/expand
 *   - <taxpert-mode-pill> custom element (mode toggle)
 *   - <taxpert-section-selector> custom element (section nav)
 *   - Prev/next page navigation buttons
 *   - Chat chip quick-action handlers
 *
 * Entry point: enableTaxpert(), called from page.html inline module script.
 * SessionStorage key: 'taxpert' → { activeTab, railCollapsed }
 */

import { enableTaxpertInspector } from './taxpert-inspector.js'

// ── Storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'taxpert'
const STORAGE_DEFAULTS = { activeTab: 'inspection', railCollapsed: false }

function readStorage () {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? { ...STORAGE_DEFAULTS, ...JSON.parse(raw) } : { ...STORAGE_DEFAULTS }
  } catch {
    return { ...STORAGE_DEFAULTS }
  }
}

function writeStorage (patch) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStorage(), ...patch }))
}

// ── Tab switching ──────────────────────────────────────────────────────────

const PANEL_TITLES = new Map([
  ['inspection', 'Inspection'],
  ['factgraph', 'FG — copy, paste, choose'],
  ['dashboards', 'Dashboards'],
  ['authoring', 'Authoring']
])

function switchTab (tabId) {
  document.querySelectorAll('.taxpert-tab').forEach(btn => {
    const active = btn.dataset.tab === tabId
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-selected', active ? 'true' : 'false')
  })

  document.querySelectorAll('.taxpert-panel-content').forEach(panel => {
    const active = panel.id === `taxpert-panel-${tabId}`
    panel.classList.toggle('hidden', !active)
    if (active) {
      panel.removeAttribute('hidden')
    } else {
      panel.setAttribute('hidden', '')
    }
  })

  const titleEl = document.getElementById('taxpert-panel-label')
  if (titleEl) {
    titleEl.textContent = PANEL_TITLES.has(tabId) ? PANEL_TITLES.get(tabId) : tabId
  }

  writeStorage({ activeTab: tabId })
}

// ── Rail collapse ──────────────────────────────────────────────────────────

function setRailCollapsed (collapsed) {
  document.body.classList.toggle('taxpert-rail-collapsed', collapsed)
  const btn = document.getElementById('taxpert-rail-collapse')
  if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
  writeStorage({ railCollapsed: collapsed })
}

// ── Rail resize ─────────────────────────────────────────────────────────

function initializeRailResize () {
  const rail = document.querySelector('.taxpert-rail')
  const handle = document.getElementById('taxpert-rail-resize-handle')
  if (!rail || !handle) return

  let isResizing = false
  let startX = 0
  let startWidth = 0

  handle.addEventListener('mousedown', (e) => {
    isResizing = true
    startX = e.clientX
    startWidth = rail.getBoundingClientRect().width
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  })

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return
    const delta = e.clientX - startX
    const newWidth = Math.max(280, Math.min(window.innerWidth * 0.6, startWidth - delta))
    // The grid reacts to --taxpert-rail-width; no need to set rail.style.width
    document.documentElement.style.setProperty('--taxpert-rail-width', newWidth + 'px')
  })

  document.addEventListener('mouseup', () => {
    if (!isResizing) return
    isResizing = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    const newWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--taxpert-rail-width'))
    writeStorage({ railWidth: newWidth })
  })
}

// ── Page navigation ────────────────────────────────────────────────────────

function navigatePrev () {
  // Try back-link in header first, then form-actions outline button
  const backLink =
    document.querySelector('.header-bottom-border a.back-link') ??
    document.querySelector('.form-actions a.usa-button--outline')
  if (backLink) window.location.href = backLink.href
}

function navigateNext () {
  // Click the Continue button so handleSectionContinue() fires
  const nextBtn = document.querySelector('.form-actions a.usa-button:not(.usa-button--outline)')
  if (nextBtn) nextBtn.click()
}

// ── Custom element: taxpert-section-selector ──────────────────────────────

class TaxpertSectionSelector extends HTMLElement {
  connectedCallback () {
    this._select = this.querySelector('select')
    // Populate once DOM settles (step indicator may render after this callback)
    requestAnimationFrame(() => {
      this._populateSections()
      this._select?.addEventListener('change', () => {
        if (this._select.value) window.location.href = this._select.value
      })
    })
    // Re-mark current section when fact graph loads (page may redirect on fg-load)
    document.addEventListener('fg-load', () => this._markCurrentSection(), { once: false })
  }

  _populateSections () {
    const labels = document.querySelectorAll('.usa-step-indicator__segment-label')
    if (!labels.length || !this._select) return

    this._select.innerHTML = ''

    labels.forEach(label => {
      const anchor = label.querySelector('a.usa-step-indicator__link')
      const currentSpan = label.querySelector('[aria-current="step"]')

      // Extract visible text, skipping sr-only spans
      const visibleSpan = anchor
        ? Array.from(anchor.querySelectorAll('span')).find(s => !s.classList.contains('usa-sr-only'))
        : Array.from(label.querySelectorAll('span')).find(s => !s.classList.contains('usa-sr-only'))
      const text = visibleSpan?.textContent?.trim() ?? label.textContent.trim().split('\n')[0].trim()

      const href = anchor?.href ?? (currentSpan ? window.location.href : '')

      const opt = document.createElement('option')
      opt.value = href
      opt.textContent = text
      if (currentSpan) opt.selected = true
      if (!href) opt.disabled = true
      this._select.appendChild(opt)
    })
  }

  _markCurrentSection () {
    if (!this._select) return
    const currentPath = window.location.pathname
    const opts = Array.from(this._select.options)
    const match = opts.find(o => {
      if (!o.value) return false
      try {
        const optPath = new URL(o.value, window.location.origin).pathname.replace(/\/$/, '')
        return currentPath.replace(/\/$/, '').startsWith(optPath)
      } catch { return false }
    })
    if (match) this._select.value = match.value
  }
}

if (!customElements.get('taxpert-section-selector')) {
  customElements.define('taxpert-section-selector', TaxpertSectionSelector)
}

// ── Chat chip quick-actions ────────────────────────────────────────────────

function handleChatChip (action) {
  switch (action) {
    case 'find-something':
      // Switch to Inspection tab and focus the fact search input
      switchTab('inspection')
      document.querySelector('#fact-select')?.focus()
      break
    case 'load-scenario':
      // Switch to FG tab and focus the load textarea
      switchTab('factgraph')
      document.querySelector('#load-fact-graph')?.focus()
      break
    case 'look-for-efficiencies':
      // Jump to Dashboards tab
      switchTab('dashboards')
      break
    default:
      break
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

export function enableTaxpert () {
  // Ensure Taxpert stylesheet is enabled (the synchronous inline script in head.html
  // handles this at parse time, but this covers any dynamic load paths)
  const stylesLink = document.getElementById('taxpert-styles')
  if (stylesLink) stylesLink.removeAttribute('disabled')

  // Mount inspector content into rail panels and wire up inspector interactions
  enableTaxpertInspector()

  // Restore persisted shell state
  const stored = readStorage()

  // ── Tab switching ──────────────────────────────────────
  document.querySelectorAll('.taxpert-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })
  switchTab(stored.activeTab ?? 'inspection')

  // ── Rail collapse ──────────────────────────────────────
  const collapseBtn = document.getElementById('taxpert-rail-collapse')
  collapseBtn?.addEventListener('click', () => {
    const willCollapse = !document.body.classList.contains('taxpert-rail-collapsed')
    setRailCollapsed(willCollapse)
  })
  setRailCollapsed(stored.railCollapsed ?? false)

  // ── Rail resize ─────────────────────────────────────────
  initializeRailResize()
  // Restore saved rail width — update the CSS variable; the grid reacts automatically
  if (stored.railWidth) {
    document.documentElement.style.setProperty('--taxpert-rail-width', stored.railWidth + 'px')
  }

  // ── Page navigation ────────────────────────────────────
  document.getElementById('taxpert-prev-btn')?.addEventListener('click', navigatePrev)
  document.getElementById('taxpert-next-btn')?.addEventListener('click', navigateNext)

  // ── Chat chips ─────────────────────────────────────────
  document.querySelectorAll('.taxpert-chat-chip').forEach(chip => {
    chip.addEventListener('click', () => handleChatChip(chip.dataset.action))
  })
}

window.enableTaxpert = enableTaxpert
