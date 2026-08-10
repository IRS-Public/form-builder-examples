// This application's flow entry point.
//
// The custom elements, the Fact Graph bootstrap and the navigation all come from taxpert's
// flow-runtime bundle — importing it is what defines <fg-set>, <fg-collection>, <fg-show> and the
// rest. What remains here is the one element that is this application's own: the W-4 adjustment
// table, whose flow node is registered on the Scala side in gov.irs.twe.app.
//
// Order matters only in that the runtime must be imported first: it owns the Fact Graph the module
// below reads at import time.

import '../vendor/taxpert/flow-runtime/js/flow-runtime.js'

import './fg-withholding-adjustments.js'
