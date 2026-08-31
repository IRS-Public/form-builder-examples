/**
 * Writes this application's scenario corpus, from Direct File's own backend scenarios.
 *
 * The application is built with `--scenarioMode`, which gives the workspace a Scenario picker and
 * the Fact Explorer a scenario list — and both were empty, because `scenarios/` had no files in it.
 * The graphs to fill it with already existed: `verify-visibility.ts` builds all of them on every
 * parity run, through upstream's own `setupFactGraph`, and throws them away at the end. This script
 * is that run without the comparison, keeping what it built.
 *
 * What a scenario file *is*, here: exactly the JSON `GraphFactory.fromJSON` accepts — the flat
 * `{"/path": {"$type": …, "item": …}}` shape that `fact-graph-io.js` fetches and hands to
 * `loadFactGraph`. So the corpus is `asOurFormat(setupFactGraph(facts).factGraph.toJSON())`, once
 * per scenario, and nothing about it is particular to this port beyond that translation.
 *
 * Each scenario is loaded back through *this* application's dictionary before it is written. A file
 * the workspace cannot load is worse than a missing one — it fails in the browser, at the person
 * using it — and the check costs one `fromJSON` per scenario.
 *
 *     make export-scenarios
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { setupFactGraph } from '/src/test/setupFactGraph.js';
import { asOurFormat, readScenarios, scenarioFileName } from './scenario-graph.ts';

const DF_CLIENT_APP = process.argv[2];
const APP = process.argv[3];
if (!DF_CLIENT_APP || !APP) {
  throw new Error(`usage: vite-node --root <df-client-app> export-scenarios.ts <df-client-app> <app-root>`);
}

/** Written by `make site`: this application's 36 modules plus the synthesized gates. */
const DICTIONARY = join(APP, `out/app/direct-file/resources/fact-dictionary.xml`);
const OUT = join(APP, `src/main/resources/direct-file/scenarios`);

const fg = await import(join(APP, `src/main/resources/direct-file/website-static/vendor/fact-graph/factgraph-3.1.0.js`));
const dictionary = fg.FactDictionaryFactory.importFromXml(readFileSync(DICTIONARY, `utf8`));

const scenarios = readScenarios(DF_CLIENT_APP);
if (scenarios.length === 0) {
  throw new Error(`no scenarios found under ${DF_CLIENT_APP}/src/test/factDictionaryTests/`);
}

// Generated contents, one writer. Clearing first is what keeps a scenario upstream has renamed or
// dropped from lingering as a file nothing regenerates — but only the `.json` it wrote, rather than
// the directory: `.gitkeep` is checked in so the folder survives a clean checkout with no corpus in
// it, and removing the directory removed that too.
mkdirSync(OUT, { recursive: true });
for (const stale of readdirSync(OUT).filter((f) => f.endsWith(`.json`))) {
  rmSync(join(OUT, stale));
}

let written = 0;
const failures: { name: string; because: string }[] = [];

for (const { name, facts } of scenarios) {
  try {
    const { factGraph } = setupFactGraph(facts);
    const json = asOurFormat(factGraph.toJSON());
    // The check that matters: this application's dictionary has to accept it.
    fg.GraphFactory.fromJSON(dictionary, json);
    writeFileSync(join(OUT, scenarioFileName(name)), `${JSON.stringify(JSON.parse(json), null, 2)}\n`);
    written += 1;
  } catch (e) {
    failures.push({ name, because: e instanceof Error ? e.message : String(e) });
  }
}

console.log(`scenarios in       ${scenarios.length}`);
console.log(`written            ${written}`);
console.log(`unloadable         ${failures.length}`);
for (const f of failures) console.log(`  ${f.name}: ${f.because}`);
console.log(`\nWrote ${OUT}`);

// A scenario this application cannot load is a real difference between the two dictionaries, which
// is the one thing this port claims there is none of. Fail rather than write a shorter corpus.
if (failures.length > 0) process.exit(1);
