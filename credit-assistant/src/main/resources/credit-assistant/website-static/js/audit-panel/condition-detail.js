import { factDictionaryXml, XML_SERIALIZER } from './fact-dictionary.js'

/**
 * Turn on the "show conditions" overlay: adds the `display-conditions` body class and injects a
 * `<condition-detail>` chip into every `[condition]` element and a shared inline box into every
 * `<fg-set>` (naming its writable fact + show-condition). Mutates the live DOM; reverse via
 * hideConditions().
 */
export function displayConditions () {
  document.body.classList.add('display-conditions')

  // Conditions on alerts (and any other [condition] element). <fg-set>s are
  // handled below so their gate condition shares one inline box with the
  // <Writable> fact the question binds to.
  document.querySelectorAll('[condition]').forEach((el) => {
    if (el.tagName.toLowerCase() === 'fg-set') return

    const operator = el.getAttribute('operator')
    const conditionPath = el.getAttribute('condition')
    if (!operator || !conditionPath) return

    const abstractPath = conditionPath.replace(/#[^/]+/, '*')

    const detail = document.createElement('condition-detail')
    detail.setAttribute('condition-path', conditionPath)
    detail.setAttribute('condition-operator', operator)
    detail.setAttribute('abstract-path', abstractPath)

    if (el.tagName.toLowerCase() === 'span') {
      el.appendChild(detail)
    } else {
      el.prepend(detail)
    }
  })

  // Each <fg-set> gets a single inline box that names the <Writable> fact the
  // question binds to/sets, followed (when the question is gated by if-true /
  // if-false) by its show-condition with completeness + a "show definition" link.
  document.querySelectorAll('fg-set').forEach((fgSet) => {
    const writablePath = fgSet.path ?? fgSet.getAttribute('path')
    if (!writablePath) return

    const box = document.createElement('div')
    box.className = 'condition-detail-box'

    const writable = document.createElement('condition-detail')
    writable.setAttribute('kind', 'writable')
    writable.setAttribute('writable-path', writablePath)
    writable.setAttribute('abstract-path', writablePath.replace(/#[^/]+/, '*'))
    box.appendChild(writable)

    const operator = fgSet.getAttribute('operator')
    const conditionPath = fgSet.getAttribute('condition')
    if (operator && conditionPath) {
      const condition = document.createElement('condition-detail')
      condition.setAttribute('condition-path', conditionPath)
      condition.setAttribute('condition-operator', operator)
      condition.setAttribute('abstract-path', conditionPath.replace(/#[^/]+/, '*'))
      box.appendChild(condition)
    }

    fgSet.prepend(box)
  })
}

/**
 * Reverse displayConditions(): drops the `display-conditions` body class and removes every injected
 * `<condition-detail>` chip and `.condition-detail-box`.
 */
export function hideConditions () {
  document.body.classList.remove('display-conditions')
  document.querySelectorAll('condition-detail').forEach((el) => el.remove())
  document.querySelectorAll('.condition-detail-box').forEach((el) => el.remove())
}
window.displayConditions = displayConditions
window.hideConditions = hideConditions

class ConditionDetail extends HTMLElement {
  constructor () {
    super()
    this.renderListener = () => this.render()
    this._hideTimeout = null
  }

  connectedCallback () {
    this.kind = this.getAttribute('kind') ?? 'condition'
    this.abstractPath = this.getAttribute('abstract-path')
    if (this.kind === 'writable') {
      // Writable variant: just a static chip naming the fact the question binds
      // to/sets — no popover and no live updates needed.
      this.writablePath = this.getAttribute('writable-path')
      this.conditionPath = this.writablePath
      this.render()
      return
    }

    this.conditionPath = this.getAttribute('condition-path')
    this.operator = this.getAttribute('condition-operator')

    this._popover = document.createElement('div')
    this._popover.className = 'condition-detail-popover'
    document.body.appendChild(this._popover)
    this._popover.addEventListener('mouseenter', () =>
      clearTimeout(this._hideTimeout)
    )
    this._popover.addEventListener('mouseleave', () => this._startHide())

    document.addEventListener('fg-update', this.renderListener)
    this.render()
  }

  disconnectedCallback () {
    document.removeEventListener('fg-update', this.renderListener)
    this._popover?.remove()
  }

  _startHide () {
    this._hideTimeout = setTimeout(
      () => this._popover.classList.remove('visible'),
      150
    )
  }

  render () {
    if (this.kind === 'writable') {
      this._renderWritable()
    } else {
      this._renderCondition()
    }
  }

  // Static chip: just names the <Writable> fact the question binds to/sets.
  _renderWritable () {
    this.classList.add('condition-detail--writable')

    const factDef = factDictionaryXml.querySelector(
      `Fact[path="${this.abstractPath}"]`
    )
    const isWritableFact = !!factDef?.querySelector('Writable')
    const statusText = isWritableFact ? 'WRITABLE' : 'NOT_WRITABLE'
    const statusClass = isWritableFact
      ? 'condition-detail__status--writable'
      : 'condition-detail__status--hidden'

    const pathHtml = this.abstractPath.includes('*')
      ? `<span class="condition-detail__path">${this.conditionPath}</span>`
      : `<fact-link path="${this.conditionPath}"><span class="condition-detail__path">${this.conditionPath}</span></fact-link>`

    this.innerHTML = `
      <span class="condition-detail__status ${statusClass}">${statusText}</span>
      ${pathHtml}
    `
  }

  _renderCondition () {
    // The conditioned host (fg-alert, or the fg-set when its gate lives in our
    // shared box) carries the runtime `hidden` class, so resolve it via closest.
    const isHidden = this.closest('[condition]')?.classList.contains('hidden') ?? false
    const statusText = isHidden ? 'UNSET_CONDITION' : 'SET_CONDITION'
    const statusClass = isHidden
      ? 'condition-detail__status--hidden'
      : 'condition-detail__status--shown'

    let completeText = ''
    if (window.factGraph) {
      try {
        const fact = window.factGraph.get(this.conditionPath)
        completeText = fact.complete ? 'complete' : 'incomplete'
      } catch (e) {
        completeText = '(error)'
      }
    }

    const pathHtml = this.abstractPath.includes('*')
      ? `<span class="condition-detail__path">${this.conditionPath}</span>`
      : `<fact-link path="${this.conditionPath}"><span class="condition-detail__path">${this.conditionPath}</span></fact-link>`

    this.innerHTML = `
      <span class="condition-detail__status ${statusClass}">${statusText}</span>
      ${pathHtml}
      <span class="condition-detail__complete">${completeText}</span>
      <button class="condition-detail__debug-btn" type="button">show definition</button>
    `

    this._popover.innerHTML = this._buildHumanReadable()
    this._popover.querySelectorAll('.hr-toggle-xml').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._popover.querySelector('.hr-fact').hidden =
          !this._popover.querySelector('.hr-fact').hidden
        this._popover.querySelector('.hr-xml-view').hidden =
          !this._popover.querySelector('.hr-xml-view').hidden
      })
    })

    const btn = this.querySelector('.condition-detail__debug-btn')
    btn.addEventListener('mouseenter', () => {
      clearTimeout(this._hideTimeout)
      const rect = btn.getBoundingClientRect()
      this._popover.style.top = `${rect.bottom + 4}px`
      this._popover.style.left = `${rect.left}px`
      this._popover.classList.add('visible')
    })
    btn.addEventListener('mouseleave', () => this._startHide())
  }

  _getFactLabel (rawAbstractPath) {
    const factNode = factDictionaryXml.querySelector(
      `Fact[path="${rawAbstractPath}"]`
    )
    const nameText = factNode?.querySelector('Name')?.textContent?.trim()
    if (nameText) return nameText
    const segment =
      rawAbstractPath.split('/').filter(Boolean).pop() ?? rawAbstractPath
    return segment
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim()
  }

  _resolveAbstractPath (rawPath) {
    if (!rawPath.startsWith('..')) return rawPath
    const prefix = this.abstractPath.replace(/\*\/.*/, '*')
    return rawPath.replace('..', prefix)
  }

  _resolveConcretePath (rawPath, collectionId) {
    let p = this._resolveAbstractPath(rawPath)
    if (collectionId) p = p.replace('*', `#${collectionId}`)
    return p
  }

  _getDepValue (concretePath) {
    if (!concretePath || concretePath.includes('*')) return null
    try {
      const fact = window.factGraph.get(concretePath)
      return fact.hasValue
        ? { value: fact.get.toString(), complete: fact.complete }
        : null
    } catch {
      return null
    }
  }

  _renderDep (node, collectionId, { negated = false, isComplete = false } = {}) {
    const rawPath = node?.getAttribute('path')
    if (!rawPath) return ''
    const abstractPath = this._resolveAbstractPath(rawPath)
    const label = this._getFactLabel(abstractPath)
    const concrete = this._resolveConcretePath(rawPath, collectionId)
    const result = this._getDepValue(concrete)

    const pathSpan = `<span class="hr-dep-path" title="${rawPath}">${label}</span>`

    if (isComplete) {
      const answered = result !== null
      const chip = answered
        ? `<span class="hr-val hr-val--answered">${result.value}</span>`
        : ''
      return `<span class="hr-dep">${pathSpan} <span class="hr-qualifier">${answered ? 'has been answered' : 'has not been answered'}</span>${chip}</span>`
    }
    if (negated) {
      const chip = result
        ? `<span class="hr-val hr-val--secondary">${result.value}</span>`
        : ''
      return `<span class="hr-dep">${pathSpan} <span class="hr-qualifier">is false</span>${chip}</span>`
    }

    let chip = ''
    if (result) {
      const cls =
        result.value === 'true'
          ? 'hr-val--true'
          : result.value === 'false'
            ? 'hr-val--false'
            : 'hr-val--other'
      const incomplete = !result.complete
        ? ' <span class="hr-incomplete">(incomplete)</span>'
        : ''
      chip = ` <span class="hr-val ${cls}">${result.value}</span>${incomplete}`
    }
    return `<span class="hr-dep">${pathSpan}${chip}</span>`
  }

  _renderNode (node, collectionId) {
    if (!node || node.nodeType !== 1) return ''
    const tag = node.tagName
    const kids = Array.from(node.children)

    switch (tag) {
      case 'Derived':
        return this._renderNode(kids[0], collectionId)

      case 'Writable': {
        const type = kids[0]?.tagName ?? 'value'
        return `<span class="hr-writable">User-entered ${type}</span>`
      }

      case 'Any':
      case 'All': {
        const label = tag === 'Any' ? 'ANY of:' : 'ALL of:'
        const cls = tag === 'Any' ? 'hr-any' : 'hr-all'
        const rows = kids
          .map((c) => `<li>${this._renderNode(c, collectionId)}</li>`)
          .join('')
        return `<div class="hr-group ${cls}"><span class="hr-op">${label}</span><ul>${rows}</ul></div>`
      }

      case 'Not': {
        const child = kids[0]
        if (!child) return ''
        if (child.tagName === 'Dependency') { return this._renderDep(child, collectionId, { negated: true }) }
        if (child.tagName === 'IsComplete') {
          return this._renderDep(child.children[0], collectionId, {
            isComplete: true,
            negated: true,
          })
        }
        return `<div class="hr-not"><span class="hr-op hr-op--not">NOT:</span> ${this._renderNode(child, collectionId)}</div>`
      }

      case 'IsComplete':
        return this._renderDep(kids[0], collectionId, { isComplete: true })

      case 'Dependency':
        return this._renderDep(node, collectionId)

      case 'Switch': {
        const rows = kids
          .map((c) => this._renderNode(c, collectionId))
          .join('')
        return `<div class="hr-switch">${rows}</div>`
      }

      case 'Case': {
        const when = node.querySelector('When')?.children[0]
        const then = node.querySelector('Then')?.children[0]
        return `<div class="hr-case"><span class="hr-kw">if</span> ${this._renderNode(when, collectionId)} <span class="hr-kw">→</span> ${this._renderNode(then, collectionId)}</div>`
      }

      case 'Equal': {
        const left = node.querySelector('Left')?.children[0]
        const right = node.querySelector('Right')?.children[0]
        return `${this._renderNode(left, collectionId)} <span class="hr-eq">=</span> ${this._renderNode(right, collectionId)}`
      }

      case 'True':
        return '<span class="hr-literal">always</span>'

      case 'String':
        return `<span class="hr-literal">"${node.textContent}"</span>`

      case 'Enum':
        return `<span class="hr-literal">${node.textContent}</span>`

      default:
        return `<span class="hr-unknown" title="unhandled: ${tag}">${tag}</span>`
    }
  }

  _buildHumanReadable () {
    const factDef = factDictionaryXml.querySelector(
      `Fact[path="${this.abstractPath}"]`
    )
    if (!factDef) { return '<p class="hr-error">(fact not found in dictionary)</p>' }

    const collectionId = this._extractCollectionId()

    let headerChip = ''
    try {
      const fact = window.factGraph.get(this.conditionPath)
      if (fact.hasValue) {
        const v = fact.get.toString()
        const cls =
          v === 'true'
            ? 'hr-val--true'
            : v === 'false'
              ? 'hr-val--false'
              : 'hr-val--other'
        headerChip = `<span class="hr-val ${cls}">${v}</span>`
      }
    } catch {
      /* fact may not be accessible */
    }

    const body = this._renderNode(factDef.firstElementChild, collectionId)

    return `<div class="hr-fact">
      <div class="hr-fact-header">
        <span class="hr-fact-path">${this.conditionPath}</span>
        ${headerChip}
      </div>
      <div class="hr-body">${body}</div>
      <button class="hr-toggle-xml" type="button">Show XML</button>
    </div>
    <div class="hr-xml-view" hidden>
      <pre><code>${this._buildAnnotatedXml()}</code></pre>
      <button class="hr-toggle-xml" type="button">Show summary</button>
    </div>`
  }

  _buildAnnotatedXml () {
    const factDef = factDictionaryXml.querySelector(
      `Fact[path="${this.abstractPath}"]`
    )
    if (!factDef) return '(fact not found in dictionary)'

    const collectionId = this._extractCollectionId()

    // Serialize and escape the XML, mirroring AuditedFact.render() and Graph.debugFact()
    let xmlStr = XML_SERIALIZER.serializeToString(factDef)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('\n')
      .map((line, i) => (i === 0 ? line : line.replace(/^ {4}/, '')))
      .join('\n')

    // Annotate each <Dependency> with its current value, matching debugFact's ⮕ annotation
    Array.from(factDef.querySelectorAll('Dependency')).forEach((dep) => {
      const rawPath = dep.getAttribute('path')
      if (!rawPath) return

      const resolvedAbstract = rawPath.startsWith('..')
        ? rawPath.replace('..', this.abstractPath.replace(/\*\/.*/, '*'))
        : rawPath

      if (resolvedAbstract.includes('*')) return

      const concreteDep = collectionId
        ? resolvedAbstract.replace('*', `#${collectionId}`)
        : resolvedAbstract

      try {
        const fact = window.factGraph.get(concreteDep)
        const annotation = fact.hasValue
          ? ` ⮕ ${fact.get} (${fact.complete ? 'complete' : 'incomplete'})`
          : ' ⮕ (no value)'
        xmlStr = xmlStr.replace(
          `path="${rawPath}"`,
          `path="${rawPath}"${annotation}`
        )
      } catch (e) {
        /* path may not exist yet */
      }
    })

    return xmlStr
  }

  _extractCollectionId () {
    const abstractSegs = this.abstractPath.split('/')
    const concreteSegs = this.conditionPath.split('/')
    for (const [i, abstractSeg] of abstractSegs.entries()) {
      if (abstractSeg === '*') {
        const [seg = ''] = concreteSegs.slice(i, i + 1)
        return seg.startsWith('#') ? seg.slice(1) : null
      }
    }
    return null
  }
}
customElements.define('condition-detail', ConditionDetail)
