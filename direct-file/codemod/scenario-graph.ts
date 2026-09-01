/**
 * The Direct File scenario corpus, as this application reads it.
 *
 * Two consumers, one definition. `verify-visibility.ts` loads every scenario to check the gate facts
 * against upstream's own conditions; `export-scenarios.ts` loads the same ones to write them out as
 * this application's scenario corpus. They were one file's private helpers until the corpus needed
 * them too, and a second copy of `asOurFormat` is exactly the kind of drift that makes a parity gate
 * stop meaning anything — the check and the artifact have to be looking at identically-translated
 * data.
 *
 * Nothing here imports Direct File's flow, so a caller pays for `setupFactGraph` only by asking.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where the backend scenarios live, inside a `df-client-app` checkout.
 *
 * Both are symlinks into the backend's test resources. `backend-scenarios-ero` is dangling in a
 * public checkout — the ERO scenarios are not published with it — so a missing folder is skipped
 * rather than fatal, and the scenario count reported by either consumer says which case you are in.
 */
export function scenarioFolders(dfClientApp: string): string[] {
  return [
    join(dfClientApp, `src/test/factDictionaryTests/backend-scenarios`),
    join(dfClientApp, `src/test/factDictionaryTests/backend-scenarios-ero`),
  ].filter((folder) => existsSync(folder));
}

export interface ScenarioFile {
  /** The scenario's own name upstream, without `.json` — e.g. `1099r-savers-mfj-primary`. */
  name: string;
  /** The `facts` object `setupFactGraph` takes. */
  facts: unknown;
}

/**
 * Every scenario in every folder, in a stable order.
 *
 * `*.expected.json` files sit beside the scenarios and are the backend's assertions about them, not
 * scenarios themselves.
 */
export function readScenarios(dfClientApp: string): ScenarioFile[] {
  const out: ScenarioFile[] = [];
  for (const folder of scenarioFolders(dfClientApp)) {
    const files = readdirSync(folder)
      .filter((f) => f.endsWith(`.json`) && !f.endsWith(`.expected.json`))
      .sort();
    for (const file of files) {
      out.push({
        name: file.replace(/\.json$/, ``),
        facts: JSON.parse(readFileSync(join(folder, file), `utf8`)).facts,
      });
    }
  }
  return out;
}

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
export function asOurFormat(json: string): string {
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

/**
 * Upstream's file name as this application's, which is to say as a label.
 *
 * The scaffold builds the Scenario picker's label from the file name itself — `Website.scala` splits
 * on `_`, capitalizes each word, and uppercases `ko` and `dq`. Direct File separates with `-`, which
 * that formatter reads as one long word, so the separator is translated here rather than the
 * formatter widened: every other application in this repository already names its scenarios with
 * underscores, and this is the file name a person reads in a dropdown.
 */
export function scenarioFileName(name: string): string {
  return `${name.replace(/-/g, `_`)}.json`;
}
