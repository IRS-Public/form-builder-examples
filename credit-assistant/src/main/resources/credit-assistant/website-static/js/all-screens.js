// Toolbar state for the /all-screens audit view.
// State is persisted in sessionStorage under 'allScreens'.

import { checkCondition } from './fg-conditions.js'

const STORAGE_KEY = 'allScreens'

const defaults = {
  section: '',
  horizontalLayout: true,
  scenarioView: true,
  scenarioFilename: '',
}

function readStorage () {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults }
  } catch (e) {
    return { ...defaults }
  }
}

function writeStorage (patch) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStorage(), ...patch }))
}

function expandAllDetails () {
  document.querySelectorAll('details').forEach(d => d.setAttribute('open', 'true'))
}

// Show only the section matching `slug`. Empty slug means show every section.
function showSection (slug) {
  document.querySelectorAll('main .all-screens__section').forEach(section => {
    section.hidden = !!slug && section.dataset.section !== slug
  })
}

function applyLayout (horizontal) {
  document.body.classList.toggle('layout--horizontal', horizontal)
}

// Scenario View: re-evaluate each single-question screen's gating condition (the same condition
// that drives page-skipping in single-question-per-screen mode) against the loaded Fact Graph,
// hiding screens the user wouldn't reach. Multi-question screens have no gating condition and are
// always shown; the [condition]/[operator] elements within them are hidden via the `.hidden`
// class that fg-components.js's showOrHideAllElements() already applies — toggling
// `scenario-view` on <body> is what makes that class actually hide content on this page.
function applyScenarioView (enabled) {
  document.body.classList.toggle('scenario-view', enabled)
  document.querySelectorAll('.screen[data-gate-condition]').forEach(screen => {
    const condition = screen.dataset.gateCondition
    const operator = screen.dataset.gateOperator
    screen.hidden = enabled && !checkCondition(condition, operator)
  })
}

export function initAllScreens () {
  const layoutToggle = document.querySelector('#all-screens-toggle-layout')
  const scenarioViewToggle = document.querySelector('#all-screens-toggle-scenario-view')
  const sectionTabs = document.querySelectorAll('.all-screens__section-tab')

  // Force every collection to render its first child instance, even with an empty fact graph.
  document.querySelectorAll('fg-collection').forEach(c => c.setAttribute('disallowempty', 'true'))

  // Give fg-components a tick to materialize collection instances before we open details and
  // render condition annotations.
  setTimeout(() => {
    expandAllDetails()
    const stored = readStorage()
    if (layoutToggle) layoutToggle.checked = stored.horizontalLayout
    applyLayout(stored.horizontalLayout)
    if (scenarioViewToggle) scenarioViewToggle.checked = stored.scenarioView
    applyScenarioView(stored.scenarioView)
  }, 100)

  const stored = readStorage()
  sectionTabs.forEach(tab => {
    tab.classList.toggle('all-screens__section-tab--active', tab.dataset.section === stored.section)
  })
  showSection(stored.section)

  layoutToggle?.addEventListener('change', () => {
    writeStorage({ horizontalLayout: layoutToggle.checked })
    applyLayout(layoutToggle.checked)
  })

  scenarioViewToggle?.addEventListener('change', () => {
    writeStorage({ scenarioView: scenarioViewToggle.checked })
    applyScenarioView(scenarioViewToggle.checked)
  })

  // Re-evaluate gated screens as the user edits answers directly on this page.
  document.addEventListener('fg-update', () => applyScenarioView(scenarioViewToggle?.checked ?? false))

  sectionTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sectionTabs.forEach(t => t.classList.remove('all-screens__section-tab--active'))
      tab.classList.add('all-screens__section-tab--active')
      const slug = tab.dataset.section
      writeStorage({ section: slug })
      showSection(slug)
      if (slug) document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
}
