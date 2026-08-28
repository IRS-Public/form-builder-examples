/**
 * Stage 2 of the transpiler: the flow's structure, as Form Builder Flow XML.
 *
 * Reads the JSON stage 1 wrote — never the React app — and writes, into the target application:
 *
 *     flow/index.xml            the 25 modules, in flow order
 *     flow/<subcategory>.xml    one per Direct File subcategory, its pages in run order
 *     facts/flowGates.xml       the synthesized condition facts (stage 3, see gates.ts)
 *     codemod-manifest.json     what was mapped, what was dropped, and why (stage 5)
 *
 * ## The shape, and why
 *
 * Direct File navigates one screen at a time and decides at each step whether the next screen's
 * conditions hold. Form Builder renders a page and lets the runtime show or hide the elements on it.
 * A screen therefore becomes a `<div>` carrying that screen's conditions, and a page becomes a run
 * of consecutive screens — because `showOrHideAllElements` deletes the facts inside anything it
 * hides, which is precisely Direct File's skip-and-clear behaviour, and because a `<div>` sits in
 * the page in declaration order, so a screen the conditions reveal appears exactly where Direct File
 * would have navigated to it. Page order and in-page order are then the same fact, checked once.
 *
 * ## What is deliberately still a placeholder
 *
 * The content inside each screen. Stage 4 replaces the heading-and-component-list below with the
 * real content, and the manifest lists every component type waiting for it. Everything structural —
 * the module split, the page cuts, the routes, the ordering, the conditions and their facts — is
 * final here, and is what this checkpoint is for.
 *
 * Runs under plain `node` — Node strips the types — because nothing here needs the React app.
 * Stage 1 is the only stage that does, which is what keeps the rest of the transpiler testable
 * without a DOM and reviewable as a diff when upstream moves.
 *
 *     make transpile   (or: node codemod/emit.ts [flow-config.json] [target resources dir])
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import { GateSet, renderGateFacts, type RawScreenCondition, type ScreenGate } from './gates.ts';

interface ExtractedScreen {
  route: string;
  screenRoute: string;
  categoryRoute: string;
  subcategoryRoute: string;
  subSubcategoryRoute: string;
  conditions: RawScreenCondition[];
  collectionContext: string | null;
  collectionLoop: { loopName: string; autoIterate: boolean; isInner: boolean; fullRoute: string } | null;
  isKnockout: boolean;
  content: { componentName: string; props: Record<string, unknown> }[];
  setActions: unknown[];
  factPaths: string[];
}

interface ExtractedPage {
  route: string;
  categoryRoute: string;
  subcategoryRoute: string;
  subSubcategoryRoute: string | null;
  loopName: string | null;
  screenIndices: number[];
  fromSplitSubSubcategory: boolean;
}

interface Extracted {
  counts: Record<string, number>;
  screens: ExtractedScreen[];
  pages: ExtractedPage[];
  categories: {
    route: string;
    subcategories: {
      route: string;
      categoryRoute: string;
      loops: { loopName: string; collectionName: string; autoIterate: boolean; isInner: boolean }[];
    }[];
  }[];
}

// Direct File serves its flow under /flow; this application is already mounted at /app/direct-file,
// so the segment is redundant here and would show up in every route and every Browse All entry.
const FLOW_PREFIX = `/flow`;
const GATES_FILE = `flowGates.xml`;

function stripFlow(route: string): string {
  return route.startsWith(FLOW_PREFIX) ? route.slice(FLOW_PREFIX.length) : route;
}

/** `/you-and-your-family/about-you` → `you-and-your-family-about-you`. */
function moduleSlug(subcategoryRoute: string): string {
  return stripFlow(subcategoryRoute).replace(/^\//, ``).replace(/\//g, `-`);
}

/** `your-basic-information` → `Your basic information`. A placeholder title; stage 4 has the real one. */
function humanize(segment: string): string {
  const words = segment.replace(/-/g, ` `).trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Every fact path the application's dictionary declares.
 *
 * A gate that names a path the dictionary does not have fails deep inside the Fact Graph's
 * initialisation, several frames from anything that says which flow condition caused it. Reading the
 * declared paths here turns that into a message naming the gate, the screen and the path.
 */
function declaredFactPaths(factsDir: string): Set<string> {
  const paths = new Set<string>();
  for (const name of readdirSync(factsDir)) {
    if (!name.endsWith(`.xml`) || name === GATES_FILE) continue;
    // Both quote styles: the copied dictionary carries a handful of single-quoted `path='…'` facts,
    // and reading only the double-quoted ones would report them as missing.
    for (const match of readFileSync(join(factsDir, name), `utf8`).matchAll(/<Fact\s+path=("([^"]+)"|'([^']+)')/g)) {
      paths.add(match[2] ?? match[3]);
    }
  }
  return paths;
}

/** `/primaryFiler/x` is a `<Find>` over `/filers`, so the fact it reaches is declared as `/filers/*\/x`. */
function dictionaryPath(path: string): string {
  for (const alias of [`/primaryFiler/`, `/secondaryFiler/`]) {
    if (path.startsWith(alias)) return `/filers/*/${path.slice(alias.length)}`;
  }
  return path;
}

function xmlAttr(value: string): string {
  return value.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`).replace(/"/g, `&quot;`);
}

function xmlText(value: string): string {
  return value.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`);
}

/** The component types on a screen, with repeats counted: `LimitingString ×3`. */
function componentSummary(screen: ExtractedScreen): string {
  const counts = new Map<string, number>();
  for (const c of screen.content) counts.set(c.componentName, (counts.get(c.componentName) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`)).join(`, `);
}

interface Manifest {
  $comment: string;
  counts: Record<string, number>;
  droppedScreens: { screen: string; because: string }[];
  droppedPages: { page: string; because: string }[];
  /** Every content component type met, and how many screens carry it. Stage 4's worklist. */
  componentTypes: Record<string, number>;
  /** Constructs stage 2 records rather than expresses, each with where it will be handled. */
  deferred: Record<string, string>;
  gates: { total: number; rootScoped: number; collectionScoped: number; sharedByMoreThanOneScreen: number };
}

function emit(extracted: Extracted, resourcesDir: string) {
  const { screens, pages } = extracted;

  // loopName → the collection it iterates. `screen.collectionLoop` carries the name but not the
  // collection; only the subcategory tree has both.
  const loopCollections = new Map<string, string>();
  for (const category of extracted.categories) {
    for (const sub of category.subcategories) {
      for (const loop of sub.loops) loopCollections.set(loop.loopName, loop.collectionName);
    }
  }

  const gateSet = new GateSet();
  const droppedPages: { page: string; because: string }[] = [];
  const componentTypes = new Map<string, number>();
  const knockouts: string[] = [];

  /** subcategory route → the XML of its pages, in order. */
  const modules = new Map<string, string[]>();

  for (const page of pages) {
    const pageScreens = page.screenIndices.map((i) => screens[i]);
    const loopCollection = page.loopName ? (loopCollections.get(page.loopName) ?? null) : null;
    if (page.loopName && !loopCollection) {
      throw new Error(`page ${page.route} names loop ${page.loopName}, which no subcategory declares`);
    }

    const blocks: string[] = [];
    for (const screen of pageScreens) {
      for (const c of screen.content) componentTypes.set(c.componentName, (componentTypes.get(c.componentName) ?? 0) + 1);

      const resolved: ScreenGate = gateSet.resolve(screen.conditions, {
        collectionContext: screen.collectionContext,
        loopCollection,
        screenRoute: screen.screenRoute,
      });
      if (resolved.kind === `never`) continue;
      if (screen.isKnockout) knockouts.push(screen.screenRoute);

      const gateAttrs =
        resolved.kind === `gate` ? ` condition="${xmlAttr(resolved.gate.conditionPath)}" operator="isTrue"` : ``;
      const classes = screen.isKnockout ? `df-screen df-knockout` : `df-screen`;
      const indent = loopCollection ? `        ` : `      `;

      blocks.push(
        `${indent}<div class="${classes}"${gateAttrs}>\n` +
          `${indent}  <h2>${xmlText(screen.route)}</h2>\n` +
          `${indent}  <p>${xmlText(componentSummary(screen))}</p>\n` +
          `${indent}</div>`
      );
    }

    if (blocks.length === 0) {
      droppedPages.push({ page: page.route, because: `every screen on it folded away` });
      continue;
    }

    const route = stripFlow(page.route);
    const title = humanize(route.split(`/`).pop() ?? route);
    const body = loopCollection
      ? `      <fg-collection path="${xmlAttr(loopCollection)}" item-name="${xmlAttr(
          loopCollection.replace(/^\//, ``)
        )}" determiner="another">\n${blocks.join(`\n`)}\n      </fg-collection>`
      : blocks.join(`\n`);

    const xml =
      `  <page title="${xmlAttr(title)}" route="${xmlAttr(route)}">\n` +
      `    <section>\n${body}\n    </section>\n` +
      `  </page>`;

    const slug = moduleSlug(page.subcategoryRoute);
    if (!modules.has(slug)) modules.set(slug, []);
    modules.get(slug)!.push(xml);
  }

  // Modules in flow order, which is the order the categories declare their subcategories.
  const moduleOrder: string[] = [];
  for (const category of extracted.categories) {
    for (const sub of category.subcategories) {
      const slug = moduleSlug(sub.route);
      if (modules.has(slug) && !moduleOrder.includes(slug)) moduleOrder.push(slug);
    }
  }
  for (const slug of modules.keys()) if (!moduleOrder.includes(slug)) moduleOrder.push(slug);

  const flowDir = join(resourcesDir, `flow`);
  const factsDir = join(resourcesDir, `facts`);
  mkdirSync(flowDir, { recursive: true });

  // Clear the previous generation, so a subcategory that stops existing upstream stops existing here
  // too. The RNG and index.xml are rewritten below; everything else in flow/ is generated.
  for (const name of readdirSync(flowDir)) {
    if (name.endsWith(`.xml`) && name !== `index.xml`) unlinkSync(join(flowDir, name));
  }

  const banner =
    `<?xml version="1.0"?>\n` +
    `<?xml-model href="./FlowConfig.rng"?>\n` +
    `<!-- GENERATED by src/scripts/to-form-builder from Direct File's flow. Do not edit: regenerate.\n` +
    `     Corrections belong in the transpiler, so the port stays reproducible against an upstream\n` +
    `     that is still moving. See codemod/README.md. -->\n`;

  for (const slug of moduleOrder) {
    writeFileSync(
      join(flowDir, `${slug}.xml`),
      `${banner}<FlowConfig>\n${modules.get(slug)!.join(`\n\n`)}\n</FlowConfig>\n`
    );
  }

  const index =
    `${banner}<FlowConfig>\n` +
    `  <!-- One module per Direct File subcategory, in the order the flow declares them. Each page\n` +
    `       becomes one directory with an index.html, in every locale. -->\n` +
    moduleOrder.map((slug) => `  <module src="./${slug}.xml"/>`).join(`\n`) +
    `\n</FlowConfig>\n`;
  writeFileSync(join(flowDir, `index.xml`), index);

  const gates = gateSet.gates;

  const declared = declaredFactPaths(factsDir);
  const unknown: string[] = [];
  for (const gate of gates) {
    for (const condition of gate.conditions) {
      if (!declared.has(dictionaryPath(condition.path))) {
        unknown.push(`${condition.path} (${gate.factPath}, from ${gate.screens[0]})`);
      }
    }
  }
  if (unknown.length > 0) {
    throw new Error(
      `${unknown.length} gate condition(s) name a fact the dictionary does not declare:\n  ` +
        `${[...new Set(unknown)].join(`\n  `)}`
    );
  }

  writeFileSync(join(factsDir, GATES_FILE), renderGateFacts(gates));

  const manifest: Manifest = {
    $comment:
      `GENERATED by src/scripts/to-form-builder. What the transpiler mapped, what it dropped and ` +
      `why, and what stage 4 still owes. An unmapped construct must never quietly vanish from 727 screens.`,
    counts: {
      screensIn: screens.length,
      screensEmitted: screens.length - gateSet.dropped.length,
      pagesIn: pages.length,
      pagesEmitted: pages.length - droppedPages.length,
      modules: moduleOrder.length,
      knockoutScreens: knockouts.length,
    },
    droppedScreens: gateSet.dropped,
    droppedPages,
    componentTypes: Object.fromEntries([...componentTypes].sort((a, b) => b[1] - a[1])),
    deferred: {
      'screen content':
        `Stage 4. Every screen currently renders its route and its component list; the 51 types in ` +
        `componentTypes are the worklist.`,
      'page titles': `Stage 4. Titles are the humanized route segment; the real one is the screen's Heading key.`,
      'knockout screens':
        `Stage 4. The ${knockouts.length} knockout screens are marked \`class="df-knockout"\` and gated ` +
        `like any other; they become <fg-alert knockout="true"> once their content exists.`,
      'collection item names':
        `Stage 7. <fg-collection item-name> is the collection's own path segment, which is a slug ` +
        `rather than a word. The real name is a locale string.`,
      'collection hubs':
        `Stage 7, and the port's largest open question. Direct File walks a loop item across many ` +
        `screens; Form Builder's <fg-collection> renders every item inline on one page. Each loop ` +
        `page therefore carries its own <fg-collection> here, which resolves the /*\/ paths correctly ` +
        `but shows the add/remove control more than once.`,
      setActions: `Stage 4. ${screens.filter((s) => s.setActions.length > 0).length} screens carry <SetFactAction>; <fg-apply> is the target.`,
    },
    gates: {
      total: gates.length,
      rootScoped: gates.filter((g) => g.scope === null).length,
      collectionScoped: gates.filter((g) => g.scope !== null).length,
      sharedByMoreThanOneScreen: gates.filter((g) => g.screens.length > 1).length,
    },
  };
  writeFileSync(join(import.meta.dirname, `manifest.json`), JSON.stringify(manifest, null, 2) + `\n`);

  return manifest;
}

const configPath = resolve(process.argv[2] ?? join(import.meta.dirname, `flow-config.json`));
const resourcesDir = resolve(process.argv[3] ?? join(import.meta.dirname, `../src/main/resources/direct-file`));
const manifest = emit(JSON.parse(readFileSync(configPath, `utf8`)) as Extracted, resourcesDir);

console.log(`wrote ${resourcesDir}/flow/ and facts/flowGates.xml`);
for (const [name, count] of Object.entries(manifest.counts)) console.log(`  ${name.padEnd(20)} ${count}`);
console.log(`  gates                ${manifest.gates.total} (${manifest.gates.collectionScoped} collection-scoped)`);
console.log(`  dropped screens      ${manifest.droppedScreens.length}`);
console.log(`  dropped pages        ${manifest.droppedPages.length}`);
