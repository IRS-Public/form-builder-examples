// This application's flow entry point.
//
// The custom elements, the Fact Graph bootstrap and the navigation all come from taxpert's
// flow-runtime bundle — importing it is what defines <fg-set>, <fg-collection>, <fg-show> and the
// rest. What remains here is the two pieces that are this application's own business and could not
// move into a shared package: its knockout gates and its destructive-change confirmations.
//
// Order matters only in that the runtime must be imported first: it owns the Fact Graph these two
// modules read at import time.

import '../vendor/taxpert/flow-runtime/js/flow-runtime.js'

import './fg-knockout-handlers.js'
import './fg-flow-confirmations.js'
