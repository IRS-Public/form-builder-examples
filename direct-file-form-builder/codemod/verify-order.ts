/**
 * Checks the extraction's page order against the 175 recorded scenario traversals.
 *
 * `extract.ts` asserts that its pages reproduce `flow.screens` exactly. That proves the extraction
 * is faithful to the compiler; it does not prove the compiler's array is the order a taxpayer
 * actually walks. `src/test/scenarioTests/flow-snapshots/*.csv` is the evidence for that: each one
 * records the ordered screen sequence one scenario traversed.
 *
 * The check is that every scenario walks the declaration order **forwards**, with one exception,
 * which is the mechanism rather than a violation: a collection loop starting its next item jumps
 * back to its hub. Every backward step in all 175 scenarios is that, and nothing else — so outside
 * collection loops, declaration order is navigation order, and cutting pages from runs of it cannot
 * reorder a question.
 *
 * This is the guard on the port's central claim. If upstream adds a genuine jump, it fails here
 * rather than showing up as a mis-ordered page 200 screens later.
 *
 *     make transpile-verify
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import flowNodes from '/src/flow/flow.js';
import { createFlowConfig } from '/src/flow/flowConfig.js';

// Both this file and extract.ts run under `vite-node --root <df-client-app>`, which is what makes
// the `/src/flow/...` imports above resolve. The same directory is passed in as argv so the
// snapshots can be found; see `make transpile-verify`.
const DF_CLIENT_APP = process.argv[2];
if (!DF_CLIENT_APP) throw new Error(`usage: vite-node --root <df-client-app> verify-order.ts <df-client-app>`);
const SNAPSHOTS = join(DF_CLIENT_APP, `src/test/scenarioTests/flow-snapshots`);

const flow = createFlowConfig(flowNodes);
const order = new Map(flow.screens.map((s, i) => [s.screenRoute, i]));
const loopOf = new Map(flow.screens.map((s) => [s.screenRoute, s.collectionLoop?.loopName ?? null]));
const subOf = new Map(flow.screens.map((s) => [s.screenRoute, s.subcategoryRoute]));

/** The screen routes one scenario traversed, in order, with their query strings stripped. */
function readScenario(file: string): string[] {
  return readFileSync(join(SNAPSHOTS, file), `utf8`)
    .split(`\n`)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(`Category:`) && !line.startsWith(`Subcategory:`))
    .map((line) => line.split(`?`)[0].split(`,`)[0])
    .filter((route) => route.startsWith(`/flow/`));
}

const files = readdirSync(SNAPSHOTS).filter((f) => f.endsWith(`.csv`)).sort();
const unknown = new Set<string>();
const violations: string[] = [];
let loopReEntries = 0;
let steps = 0;

for (const file of files) {
  const sequence = readScenario(file);
  for (const route of sequence) if (!order.has(route)) unknown.add(`${route}  (${file})`);

  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1];
    const to = sequence[i];
    if (!order.has(from) || !order.has(to)) continue;
    steps += 1;
    if (order.get(to)! > order.get(from)!) continue;

    // A collection loop starting its next item: leaving a loop screen for somewhere earlier in the
    // same subcategory, which is the loop's own screens or the hub sitting just before them.
    if (loopOf.get(from) && subOf.get(from) === subOf.get(to)) {
      loopReEntries += 1;
      continue;
    }
    violations.push(
      `${file}: ${from} (${order.get(from)}) -> ${to} (${order.get(to)}), ` +
        `loops ${loopOf.get(from) ?? `none`} -> ${loopOf.get(to) ?? `none`}`
    );
  }
}

console.log(`scenarios          ${files.length}`);
console.log(`navigation steps   ${steps}`);
console.log(`loop re-entries    ${loopReEntries}   (expected: a loop starting its next item)`);
console.log(`unknown routes     ${unknown.size}`);
console.log(`violations         ${violations.length}`);

if (unknown.size > 0) {
  console.error(`\nA scenario visited a screen the extraction does not have:`);
  for (const route of [...unknown].slice(0, 20)) console.error(`   ${route}`);
}
if (violations.length > 0) {
  console.error(`\nA scenario moved backwards through the flow outside a collection loop.`);
  console.error(`Declaration order is no longer navigation order, and cutting pages from runs of it`);
  console.error(`would reorder questions. See src/scripts/to-form-builder/extract.ts.\n`);
  for (const v of violations.slice(0, 20)) console.error(`   ${v}`);
}
if (unknown.size > 0 || violations.length > 0) process.exit(1);

console.log(`\nOutside collection loops, the flow's declaration order is its navigation order.`);
