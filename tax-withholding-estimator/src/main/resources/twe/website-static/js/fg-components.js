// This application's flow entry point.
//
// The custom elements, the Fact Graph bootstrap and the navigation all come from the scaffold's
// flow-runtime bundle — importing it is what defines <fg-set>, <fg-collection>, <fg-show> and the
// rest. It ships inside the form-builder jar and is extracted into resources/vendor/form-builder/ on
// every build, so it needs no npm dependency. What remains here is the one element that is this application's own: the W-4 adjustment
// table, whose flow node is registered on the Scala side in gov.irs.twe.app.
//
// Order matters only in that the runtime must be imported first: it owns the Fact Graph the module
// below reads at import time.

import '../vendor/form-builder/flow-runtime/js/flow-runtime.js'

import './fg-withholding-adjustments.js'
