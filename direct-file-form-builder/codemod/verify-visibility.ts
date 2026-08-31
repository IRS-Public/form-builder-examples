/**
 * Checks the synthesized gate facts against Direct File's own screen conditions, scenario by
 * scenario. This is the port's parity gate.
 *
 * `verify-order.ts` proves that declaration order is navigation order, so cutting pages from runs of
 * it cannot reorder a question. That leaves the other half of the claim: that a screen shows for
 * exactly the taxpayers it shows for upstream. Stage 3 rewrote every screen's ANDed condition list
 * as one derived Boolean fact, over operators the Fact Graph has and Direct File does not — so the
 * question is whether those facts agree with `Condition.evaluate`, on real data.
 *
 * The comparison is direct rather than through the browser:
 *
 *   1. Build the scenario's fact graph the way upstream's own snapshot test does, with
 *      `setupFactGraph` — same seeding of `/filers`, `/email` and the primary filer's TIN.
 *   2. Serialize it and load the same state into a graph over *this* application's dictionary, which
 *      is the same 36 modules plus `flowGates.xml`.
 *   3. For every screen, at every item of its collection, ask both: does
 *      `screen.conditions.every(evaluate)` pass, and is the gate fact true?
 *
 * Nothing about the DOM is involved, which is the point — a Playwright walk would answer the same
 * question through four more layers, each with its own reasons to differ.
 *
 * `isAvailable` is deliberately not reused. It is `conditions` *and* "an auto-iterating loop has
 * members", and the second half is `<fg-collection>`'s job in this port rather than the gate's: a
 * loop over an empty collection renders no items, so no screen inside it exists to be hidden.
 * Comparing conditions alone is comparing the thing stage 3 actually claims.
 *
 *     make transpile-verify
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import flowNodes from '/src/flow/flow.js';
import { createFlowConfig } from '/src/flow/flowConfig.js';
import { Condition } from '/src/flow/Condition.js';
import { setupFactGraph } from '/src/test/setupFactGraph.js';
// Direct File's own converter, for Direct File's own graph. The two engines are separate builds and
// a Scala collection from one is not a Scala collection the other can cast.
import { scalaListToJsArray } from '@irs/js-factgraph-scala';

const DF_CLIENT_APP = process.argv[2];
const APP = process.argv[3];
if (!DF_CLIENT_APP || !APP) {
  throw new Error(`usage: vite-node --root <df-client-app> verify-visibility.ts <df-client-app> <app-root>`);
}

/** The dictionary the generated site ships, gates included. Written by `make site`. */
const DICTIONARY = join(APP, `out/app/direct-file/resources/fact-dictionary.xml`);
// Both are symlinks into the backend's test resources. `backend-scenarios-ero` is dangling in this
// checkout — the ERO scenarios are not published with it — so a missing folder is skipped and
// counted rather than fatal.
const SCENARIOS = [
  join(DF_CLIENT_APP, `src/test/factDictionaryTests/backend-scenarios`),
  join(DF_CLIENT_APP, `src/test/factDictionaryTests/backend-scenarios-ero`),
].filter((folder) => existsSync(folder));

// The engine, as the browser loads it: the same bundle this application vendors, so the gates are
// evaluated by the code that will evaluate them in the page.
const fg = await import(join(APP, `src/main/resources/direct-file/website-static/vendor/fact-graph/factgraph-3.1.0.js`));

const screenGates: Record<string, string | null | false> = JSON.parse(
  readFileSync(join(import.meta.dirname, `screen-gates.json`), `utf8`)
);

const flow = createFlowConfig(flowNodes);
const dictionaryXml = readFileSync(DICTIONARY, `utf8`);
const dictionary = fg.FactDictionaryFactory.importFromXml(dictionaryXml);

/**
 * A serialized graph from Direct File's engine, as this one reads it.
 *
 * The two builds are the same lineage and disagree in one place: Direct File's writes an
 * `Option[String]` the way its upickle does, as a one-element array, and this one writes and reads a
 * bare string. `Enum.value` is the only field that shape reaches. Translating it here rather than
 * widening the engine's reader is deliberate — nothing in this application ever loads a graph
 * Direct File wrote, and a reader that quietly accepts two encodings is a reader that stops telling
 * you when they diverge again.
 *
 * The empty `/email` some scenarios carry is dropped rather than translated: this engine's
 * `EmailAddress` requires an `@`, `setupFactGraph` fills a real address in when the fact is absent,
 * and no screen condition reads it.
 */
function asOurFormat(json: string): string {
  const facts = JSON.parse(json) as Record<string, { $type?: string; item?: Record<string, unknown> }>;
  for (const [path, wrapper] of Object.entries(facts)) {
    const type = wrapper?.$type ?? ``;
    if (type.endsWith(`EnumWrapper`) && Array.isArray(wrapper.item?.value)) {
      wrapper.item.value = wrapper.item.value.length > 0 ? wrapper.item.value[0] : null;
    }
    if (type.endsWith(`EmailAddressWrapper`) && !String(wrapper.item?.email ?? ``).includes(`@`)) {
      delete facts[path];
    }
  }
  return JSON.stringify(facts);
}

/** The item ids of a collection, or `[null]` for a screen that is not in one. */
function itemsOf(graph: unknown, collection: string | null | undefined): (string | null)[] {
  if (!collection) return [null];
  const result = (graph as { get: (p: string) => { complete: boolean; get: unknown } }).get(collection);
  if (!result.complete) return [];
  const value = result.get as { idString?: string; getItemsAsStrings?: () => unknown };
  // `/primaryFiler` and `/secondaryFiler` are `<Find>`s: one item, not a collection.
  if (typeof value.idString === `string`) return [value.idString];
  const items = value.getItemsAsStrings?.();
  return items === undefined ? [] : (scalaListToJsArray(items as never) as string[]);
}

/** A gate path at one collection item: `/formW2s/*\/flowGateX` becomes `/formW2s/#<id>/flowGateX`. */
function concrete(path: string, itemId: string | null): string {
  return itemId === null ? path : path.replace(`/*/`, `/#${itemId}/`);
}

/**
 * The screens whose gate is known to disagree, and why. Anything else fails the run.
 *
 * Two causes, and both are on the record elsewhere rather than only here.
 *
 * **`hasValue` versus `IsComplete`.** Direct File's `isTrue` is `fact.hasValue && !!fact.get` and its
 * `isFalse` is `fact.hasValue && !fact.get`. `hasValue` is true for a *placeholder* — a value the
 * dictionary supplies until the taxpayer answers — and the Fact Graph has `IsComplete`, which is
 * false for one, and no `HasValue` CompNode at all. So a screen gated on a fact that currently holds
 * a placeholder shows upstream and hides here. Six screens, all of them gated on a fact whose
 * `<Placeholder>` is what a fresh return starts with. Closing it means a `HasValue` CompNode in
 * `fact-graph` — `Result.hasValue` already exists — and a second look at how `<All>` short-circuits
 * over a placeholder, which is what makes these gates total. That is a design change to the gate
 * scheme, not a patch, and it is deliberately not made from here.
 *
 * **The e-signature path.** `isEssarSigningPath` is not a fact; it is a build flag, and this port
 * does not have the e-signature path, so every condition on it folds to its "off" branch. The screen
 * below is the one that only exists when it is on.
 */
const KNOWN: Record<string, string> = {
  '/flow/income/jobs/w2-add-box-f-choice': `isFalse on a placeholder (/formW2s/*/isImported)`,
  '/flow/income/jobs/w2-add-box-13-options': `isTrue on a placeholder (/formW2s/*/showBox13CodesScreen)`,
  '/flow/income/jobs/w2-nonstandard-corrected': `isTrue on a placeholder (/formW2s/*/showW2NonStandardOrCorrectedScreen)`,
  '/flow/income/jobs/w2-add-whose-w2': `isTrue on a placeholder (/formW2s/*/showWhoseW2Screen)`,
  '/flow/you-and-your-family/spouse/spouse-pfd-income': `isFalse on a placeholder (/spouseLivesOrHasW2InAnotherState)`,
  '/flow/income/interest/1099-int-add-whose': `isFalse on a placeholder (/interestReports/*/isImported)`,
  '/flow/your-taxes/other-preferences/create-new-self-select-pin': `out of scope: the e-signature path`,
};

interface Mismatch {
  scenario: string;
  screen: string;
  directFile: boolean;
  port: boolean;
  gate: string | null | false;
}

const mismatches: Mismatch[] = [];
let scenarios = 0;
let comparisons = 0;
let agreements = 0;
const screensWithAMismatch = new Set<string>();

for (const folder of SCENARIOS) {
  for (const file of readdirSync(folder).filter((f) => f.endsWith(`.json`) && !f.endsWith(`.expected.json`))) {
    const facts = JSON.parse(readFileSync(join(folder, file), `utf8`)).facts;
    const { factGraph } = setupFactGraph(facts);
    // Same state, this application's dictionary. Serializing the seeded graph rather than reloading
    // the file is what keeps the two sides looking at identical data.
    const portGraph = fg.GraphFactory.fromJSON(dictionary, asOurFormat(factGraph.toJSON()));
    scenarios += 1;

    for (const screen of flow.screens) {
      const gate = screenGates[screen.screenRoute];
      if (gate === undefined) continue; // a screen the extraction does not have; verify-order covers that

      for (const itemId of itemsOf(factGraph, screen.collectionContext)) {
        const directFile = (screen.conditions ?? []).every((raw: unknown) =>
          new Condition(raw as never).evaluate(factGraph as never, itemId)
        );

        let port: boolean;
        if (gate === false) port = false;
        else if (gate === null) port = true;
        else {
          const result = portGraph.get(concrete(gate, itemId));
          port = result.complete === true && result.get === true;
        }

        comparisons += 1;
        if (directFile === port) {
          agreements += 1;
        } else {
          screensWithAMismatch.add(screen.screenRoute);
          mismatches.push({ scenario: file, screen: screen.screenRoute, directFile, port, gate });
        }
      }
    }
  }
}

const unexpected = mismatches.filter((m) => !Object.hasOwn(KNOWN, m.screen));
const known = mismatches.length - unexpected.length;

console.log(`scenarios              ${scenarios}`);
console.log(`screen/item decisions  ${comparisons}`);
console.log(`agreements             ${agreements}`);
console.log(`known differences      ${known}  (${[...screensWithAMismatch].filter((s) => Object.hasOwn(KNOWN, s)).length} screens, see KNOWN in this file)`);
console.log(`unexpected             ${unexpected.length}`);

// Every known screen must still differ. One that has come into line is a KNOWN entry to delete, and
// leaving it would let a real regression hide behind it later.
const stale = Object.keys(KNOWN).filter((screen) => !screensWithAMismatch.has(screen));
if (stale.length > 0) {
  console.error(`\n${stale.length} screen(s) in KNOWN now agree with Direct File. Remove them:`);
  for (const screen of stale) console.error(`   ${screen}`);
}

if (unexpected.length > 0) {
  // Grouped by screen: one wrong gate shows up once per scenario, and the screen is the thing to fix.
  const byScreen = new Map<string, Mismatch[]>();
  for (const m of unexpected) byScreen.set(m.screen, [...(byScreen.get(m.screen) ?? []), m]);
  const ordered = [...byScreen].sort((a, b) => b[1].length - a[1].length);
  console.error(`\nScreens whose gate disagrees with Direct File's conditions:\n`);
  for (const [screen, group] of ordered.slice(0, 40)) {
    const first = group[0];
    const direction = first.directFile ? `upstream shows it, the port hides it` : `upstream hides it, the port shows it`;
    console.error(`  ${screen}`);
    console.error(`      ${group.length}x  ${direction}  gate ${String(first.gate)}  e.g. ${first.scenario}`);
  }
  if (ordered.length > 40) console.error(`\n  … and ${ordered.length - 40} more screens.`);
  console.error(`\nIf one of these is a difference the port intends, add it to KNOWN with the reason.`);
}

if (unexpected.length > 0 || stale.length > 0) process.exit(1);

console.log(
  `\nEvery screen shows for exactly the taxpayers it shows for upstream, ` +
    `except the ${Object.keys(KNOWN).length} in KNOWN.`
);
