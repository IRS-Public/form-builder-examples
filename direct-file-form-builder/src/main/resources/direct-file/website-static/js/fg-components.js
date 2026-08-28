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

import '../vendor/form-builder/flow-runtime/js/flow-runtime.js'
