// <fg-withholding-adjustments> — the browser half of this app's one custom flow node.
//
// It lives here for the same reason its parser does (gov.irs.twe.parser.FgWithholdingAdjustments):
// the W-4 / W-4P adjustment table is this product's, and a scaffold that shipped it would be
// carrying one application's tax form for every other application to inherit.
//
// It uses only the flow runtime's public surface — the fact graph and the collection-id helper —
// which is what makes registering a node from outside the package possible at all.

import { factGraph, configureCollectionIds } from '../vendor/taxpert/flow-runtime/js/flow-runtime.js'

class FgWithholdingAdjustments extends HTMLElement {
  constructor () {
    super()
    this.updateListener = () => this.render()
  }

  connectedCallback () {
    this.path = this.getAttribute('path')
    this.render()
  }

  render () {
    const collectionIds = factGraph.getCollectionIds(this.path)
    collectionIds.forEach(collectionId => this.renderJob(collectionId))
  }

  renderJob (collectionId) {
    const fgWithholdingAdjustments = this.closest('fg-withholding-adjustments')
    const templateContent = fgWithholdingAdjustments.querySelector('.fg-withholding-adjustment__template').content.cloneNode(true)
    configureCollectionIds(templateContent, collectionId)
    this.append(templateContent)
  }
}
customElements.define('fg-withholding-adjustments', FgWithholdingAdjustments)
