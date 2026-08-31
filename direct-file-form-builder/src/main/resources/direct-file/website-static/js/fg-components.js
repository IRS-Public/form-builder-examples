// This application's flow entry point.
//
// The custom elements, the Fact Graph bootstrap and the navigation all come from the scaffold's
// flow-runtime bundle — importing it is what defines <fg-set>, <fg-collection>, <fg-show> and the
// rest. It ships inside the form-builder jar and is extracted into resources/vendor/form-builder/ on
// every build, so it needs no npm dependency. The scaffold's page template loads this file, not the bundle directly, so that an app has
// somewhere to add its own client-side behaviour.
//
// Add yours below the import: a custom element registered as a `nodeTypes` entry on the
// FormBuilderApp, a knockout gate, a confirmation before a destructive change. Order matters only in
// that the runtime must come first — it owns the Fact Graph anything else reads at import time.

// Before the runtime, deliberately, and the only thing that may go there. flow-runtime.js runs
// showOrHideAllElements() at module scope, so by the time the import below returns the first
// conditions pass has already happened — a seed placed after it would run against a graph that has
// already thrown. Importing fg-fact-graph.js is what settles the graph's top-level await, so this
// module gets the same instance the runtime is about to read.
import './seed-fact-graph.js'

import '../vendor/form-builder/flow-runtime/js/flow-runtime.js'

// Direct File's own input types, the browser half of the `inputTypes` this app registers in
// Main.scala. Import order does not matter — registerInputType re-wires any <fg-set> that already
// connected — but they sit after the runtime because they import the Fact Graph engine through it.
import './inputs/masked-number.js'
import './inputs/address.js'
import './inputs/bank-account.js'
