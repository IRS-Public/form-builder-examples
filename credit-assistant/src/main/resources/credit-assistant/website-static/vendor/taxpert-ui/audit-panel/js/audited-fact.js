// Fact Inspector: the <fact-link> (wraps <fg-show>s and dependency links in the host flow) and
// <audited-fact> (a tracked fact card) custom elements, plus trackFact/setFactOptions. Ported
// from credit-assistant. The panel renders DOM with the same ids/classes as before, so the
// document-scoped queries here keep resolving the single panel's controls; the only structural
// change is that the <audited-fact> shadow template is built in JS (English-only labels) instead
// of cloning a server-rendered <template id="audit-panel__fact">.
import {
  factDictionaryXml,
  XML_SERIALIZER,
  makeCollectionIdPath,
} from './fact-dictionary.js'
import { getAuditPanelStorage, setAuditPanelStorage } from './storage.js'
import { setLastActiveTabButton } from './tab-state.js'

// The Fact Inspector's fact-path input; resolved lazily because the panel builds its DOM
// after this module evaluates.
const getFactSelect = () => document.querySelector('#fact-select')

// Shadow-DOM template for <audited-fact>, formerly fragments/audit-panel/fact-template.html.
// The three Thymeleaf-translated labels become English-only literals (this is a dev-only tool
// and taxpert-ui has no i18n system): audit.fact.type → "Fact Type:", audit.fact.value →
// "Value:", audit.fact.remove → "Remove fact".
const FACT_TEMPLATE_HTML = `
   <h3 part="heading" class="audit-panel__fact__path">REPLACE_ME_WITH_FACT_PATH</h3>
   <dl part="fact-data">
      <dt part="fact-term">Fact Type:</dt>
      <dd part="fact-definition" class="audit-panel__fact__type"></dd>
   </dl>
   <dl part="fact-data">
      <dt part="fact-term">Value:</dt>
      <dd part="fact-definition" class="audit-panel__fact__value"></dd>
   </dl>
   <div class="audit-panel__fact__definition">
      <pre part="code-block"><code><slot name="definition"></slot></code></pre>
   </div>
   <div class="audit-panel__fact__controls">
      <button part="remove-button" class="usa-button audit-panel__fact__remove" type="button">Remove fact</button>
   </div>
`
let _factTemplate = null
function factTemplateContent () {
  if (!_factTemplate) {
    _factTemplate = document.createElement('template')
    _factTemplate.innerHTML = FACT_TEMPLATE_HTML
  }
  return _factTemplate.content.cloneNode(true)
}

class FactLink extends HTMLElement {
  connectedCallback () {
    this.path = this.getAttribute('path')
    this.collectionId = this.getAttribute('collectionId')

    const link = document.createElement('a')
    link.href = `#${this.path}`
    while (this.firstChild) {
      link.appendChild(this.firstChild)
    } // Move all children to the link
    link.onclick = () => {
      const factGraphTabBtn = document.querySelector(
        '.audit-panel__tab[data-tab="fact-graph"]'
      )
      if (factGraphTabBtn) {
        setLastActiveTabButton(factGraphTabBtn)
        factGraphTabBtn.click()
      } else {
        document.body.classList.add('audit-panel-open')
        setAuditPanelStorage('isOpen', true)
      }
      trackFact(this.path, this.collectionId)
      return false
    }
    this.replaceChildren(link)
  }
}
customElements.define('fact-link', FactLink)

class AuditedFact extends HTMLElement {
  constructor () {
    super()

    this.deleteListener = () => {
      const storage = getAuditPanelStorage()
      const trackedFacts = storage.trackedFacts || []
      const newTrackedFacts = trackedFacts.filter(
        (fact) =>
          fact.path !== this.abstractPath &&
          fact.collectionId !== this.collectionId
      )
      setAuditPanelStorage('trackedFacts', newTrackedFacts)
      this.remove()
    }
    this.renderListener = () => this.render()

    const templateContent = factTemplateContent()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.append(templateContent)

    this.factPathElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__path'
    )
    this.factTypeElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__type'
    )
    this.factValueElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__value'
    )
    this.factDefinitionElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__definition'
    )

    this.removeButton = this.shadowRoot.querySelector(
      '.audit-panel__fact__remove'
    )
  }

  connectedCallback () {
    this.abstractPath = this.getAttribute('path')
    this.collectionId = this.getAttribute('collectionid')
    this.factPath = makeCollectionIdPath(this.abstractPath, this.collectionId)

    this.removeButton.addEventListener('click', this.deleteListener)
    this.addEventListener('click', this.handleLinksListener)
    document.addEventListener('fg-update', this.renderListener)

    this.render()
  }

  disconnectedCallback () {
    this.removeButton.removeEventListener('click', this.deleteListener)
    this.removeEventListener('click', this.handleLinksListener)
    document.removeEventListener('fg-update', this.renderListener)
    getFactSelect()?.focus()
  }

  render () {
    const definition = window.factGraph.dictionary.getDefinition(this.factPath)
    const fact = window.factGraph.get(this.factPath)

    // Fill out the data fields
    this.factPathElem.innerText = this.factPath
    this.factTypeElem.innerText = definition.typeNode
    const factValueString = fact.hasValue ? fact.get.toString() + ' ' : ''
    const factCompleteString = fact.complete ? '[Complete]' : '[Incomplete]'
    this.factValueElem.innerText = `${factValueString} ${factCompleteString}`

    // Serialize and sanitize the fact definition for inclusion as HTML
    // Replace brackets with HTML entities to prevent the XML from being rendered, and remove leading indentation after first line for readability
    // We do this because the definition will have live <a> links in it
    const xmlDefinition = factDictionaryXml.querySelector(
      `Fact[path="${this.abstractPath}"]`
    )
    const stringDefinition = XML_SERIALIZER.serializeToString(xmlDefinition)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('\n')
      .map((line, index) => (index === 0 ? line : line.replace(/^ {4}/, '')))
      .join('\n')

    // Enhance the definition by adding links to dependencies
    const dependencyNodes = Array.from(
      xmlDefinition.querySelectorAll('Dependency')
    )
    const fullDefinition = dependencyNodes.reduce((result, dependencyNode) => {
      const rawPath = dependencyNode.getAttribute('path')

      // For now, we can't resolve abstract collection paths ("/jobs/*/income")
      if (rawPath.includes('*')) {
        return result
      }
      // but we can resolve relative paths ("../income")
      const abstractPath = rawPath.replace(
        '..',
        this.abstractPath.replace(/\*\/.*/, '*')
      )
      const link = `<fact-link path="${abstractPath}" collectionId="${this.collectionId}">${rawPath}</fact-link>`
      return result.replace(`path="${rawPath}"`, `path="${link}"`)
    }, stringDefinition)

    const definitionElement = document.createElement('div')
    definitionElement.setAttribute('slot', 'definition')
    definitionElement.innerHTML = fullDefinition

    this.querySelector('[slot="definition"]')?.remove()
    this.append(definitionElement)
  }
}
customElements.define('audited-fact', AuditedFact)

// Fact-inspector "Add fact" button handler: tracks the fact named in the inspector input
// (`#fact-select`) under the collection id in `#fact-collection-id`, then clears the input.
function trackSelectedFact () {
  const factSelect = getFactSelect()
  const factPath = factSelect.value
  const collectionId = document.querySelector('#fact-collection-id').value
  if (factPath) {
    trackFact(factPath, collectionId)
    factSelect.value = ''
  }
}

/**
 * Add a fact to the fact-inspector's tracked list (and persist it to session storage so it survives
 * forward/back navigation). No-op beyond scrolling if the concrete fact is already tracked.
 * @param {string} path the abstract fact path
 * @param {string} collectionId collection item id to resolve a `*` wildcard, or '' for non-collection facts
 * @param {boolean} [setFocus=true] move focus to the newly added fact (skip when restoring on load)
 */
function trackFact (path, collectionId, setFocus = true) {
  const factPath = makeCollectionIdPath(path, collectionId)
  const auditedFactsList = document.querySelector('#audit-panel__fact-list')

  const existingFact = auditedFactsList.querySelector(
    `audited-fact[path="${factPath}"]`
  )
  if (existingFact) {
    return existingFact.scrollIntoView()
  }
  console.debug(`Tracking ${factPath}`)

  // Store the tracked fact in session storage so it persists across page reloads with forward/back navigation
  const storage = getAuditPanelStorage()
  const trackedFacts = storage.trackedFacts || []
  trackedFacts.push({ path, collectionId })
  setAuditPanelStorage('trackedFacts', trackedFacts)

  const auditedFact = document.createElement('audited-fact')
  auditedFact.setAttribute('path', path)
  auditedFact.setAttribute('collectionId', collectionId)

  auditedFactsList.appendChild(auditedFact)
  auditedFact.scrollIntoView()

  // Set focus to the newly added fact for accessibility, and remove the tabindex after focus is lost so the fact doesn't remain in the tab order unnecessarily
  if (setFocus) {
    auditedFact.setAttribute('tabindex', '-1')
    auditedFact.focus()

    auditedFact.addEventListener(
      'focusout',
      () => {
        auditedFact.removeAttribute('tabindex')
      },
      { once: true }
    )
  }
}

/**
 * Populate both fact-path datalists (fact-inspector `#fact-options` and chat `#chat-fact-options`)
 * with every path the fact graph knows about. Called once the graph is available.
 */
function setFactOptions () {
  const paths = window.factGraph.paths().sort()
  const options = paths.map((path) => `<option path=${path}>${path}</option>`)
  document.querySelectorAll('#fact-options, #chat-fact-options').forEach((list) => {
    list.innerHTML = options
  })
}

window.trackSelectedFact = trackSelectedFact
// onkeydown handler shared by both fact-path inputs (fact-inspector + chat). Reads the input that
// fired the event so Enter in the chat input tracks the chat input's value, not the inspector's.
window.pathSelectListener = (event) => {
  if (event.key !== 'Enter') return
  const factPath = event.target.value
  const collectionId = document.querySelector('#fact-collection-id')?.value ?? ''
  if (factPath) {
    trackFact(factPath, collectionId)
    event.target.value = ''
  }
}

export { trackFact, trackSelectedFact, setFactOptions }
