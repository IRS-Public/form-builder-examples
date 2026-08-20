// This application's flow entry point.
//
// The custom elements, the Fact Graph bootstrap and the navigation all come from the scaffold's
// flow-runtime bundle — importing it is what defines <fg-set>, <fg-collection>, <fg-show> and the
// rest. It ships inside the form-builder jar and is extracted into resources/vendor/form-builder/ on
// every build, so it needs no npm dependency. What remains here is the two pieces that are this application's own business and could not
// move into a shared package: its knockout gates and its destructive-change confirmations.
//
// Order matters only in that the runtime must be imported first: it owns the Fact Graph these two
// modules read at import time.

import '../vendor/form-builder/flow-runtime/js/flow-runtime.js'

import './fg-knockout-handlers.js'
import './fg-flow-confirmations.js'
