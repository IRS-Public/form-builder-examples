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

interface ExtractedLoop {
  loopName: string;
  itemName: string | null;
  collectionName: string;
  autoIterate: boolean;
  isInner: boolean;
}

interface Extracted {
  counts: Record<string, number>;
  screens: ExtractedScreen[];
  pages: ExtractedPage[];
  categories: {
    route: string;
    subcategories: { route: string; categoryRoute: string; loops: ExtractedLoop[] }[];
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

/**
 * The Browse All section headings the application declares, keyed by flow-module filename.
 *
 * `locales/en.yaml` is hand-written and the transpiler does not own it, so a subcategory that
 * appears upstream would otherwise ship as a section headed `all-screens.section.income-whatever`
 * on a page nobody re-reads. Read as text rather than parsed: the block is four levels of plain
 * scalars this repo writes itself, and a YAML dependency for it would be the only one in here.
 */
function declaredSectionHeadings(resourcesDir: string): Set<string> {
  const yaml = readFileSync(join(resourcesDir, `locales`, `en.yaml`), `utf8`).split(`\n`);
  const start = yaml.findIndex((line) => line === `all-screens:`);
  if (start === -1) throw new Error(`locales/en.yaml declares no all-screens: block`);

  const keys = new Set<string>();
  let inSection = false;
  for (const line of yaml.slice(start + 1)) {
    if (line.trim() !== `` && !line.startsWith(`  `)) break; // left the all-screens: block
    if (line.trimEnd() === `  section:`) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    const match = /^ {4}([A-Za-z0-9-]+):/.exec(line);
    if (match) keys.add(match[1]);
    else if (line.trim() !== `` && !line.trimStart().startsWith(`#`)) inSection = false;
  }
  return keys;
}

/**
 * Every fact path the workspace configuration names.
 *
 * The Outcome tracker's rows are fact paths in a `.js` file no compiler reads, so a fact upstream
 * renames becomes a row that is permanently blank rather than an error. Matching bare `'/factName'`
 * literals is enough: relative module specifiers start `../`, and the file has no other absolute
 * single-segment strings.
 */
function workspaceFactPaths(resourcesDir: string): string[] {
  const file = join(resourcesDir, `website-static`, `js`, `taxpert`, `direct-file-graph.js`);
  return [...readFileSync(file, `utf8`).matchAll(/'(\/[A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
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

/**
 * A loop, its pages, and the page the collection is emitted on.
 *
 * Direct File walks one collection item through many screens and returns to a hub to start the next.
 * `<fg-collection>` inverts that: it clones one block of markup per item, all on one page. So a
 * loop's pages collapse into a single `<fg-collection>`, and the whole question of *which* page it
 * lands on is decided by whether the taxpayer can change the collection.
 *
 *   - **A loop the taxpayer fills in** (`autoIterate: false`, a `<Writable><Collection/>`) already
 *     has a hub in Direct File: the screen carrying `CollectionItemManager`, which lists the items
 *     and owns Add and Remove. That screen's page sits immediately before the loop's first page in
 *     all eleven cases — checked below, not assumed — and it is where the collection goes. The hub's
 *     own content stays above it, and the Add button appears exactly once, where upstream puts it.
 *   - **A loop the taxpayer cannot change** (`autoIterate: true`) has no hub, because upstream never
 *     renders a list or an Add button over a `<Derived><Filter>` collection — it walks the people
 *     another answer already put there. Those eight get `readonly`, and land on their own first page.
 *
 * The collection is `path`ed at the loop's `collectionName` rather than a screen's
 * `collectionContext`: for `benefits-care-providers` the loop name is a slug and only the loop knows
 * it iterates `/cdccCareProviders`.
 */
interface LoopPlan extends ExtractedLoop {
  /** Indices into `pages` of the loop's own pages, contiguous and in order. */
  pageIndices: number[];
  /** The page the `<fg-collection>` is emitted on: the hub, or the loop's own first page. */
  anchorPage: number;
  /** The hub screen's index in `screens`, so the collection can inherit its condition. */
  hubScreen: number | null;
}

/**
 * Match each loop to its pages and its anchor page, failing rather than guessing.
 *
 * Both facts this relies on are properties of upstream that could stop holding, so both are checked:
 * a loop's pages are one contiguous run, and a manual loop's hub is the page immediately before it.
 */
function planLoops(extracted: Extracted): Map<string, LoopPlan> {
  const { screens, pages } = extracted;

  const declared = new Map<string, ExtractedLoop>();
  for (const category of extracted.categories) {
    for (const sub of category.subcategories) for (const loop of sub.loops) declared.set(loop.loopName, loop);
  }

  const pagesByLoop = new Map<string, number[]>();
  pages.forEach((page, i) => {
    if (page.loopName) {
      if (!declared.has(page.loopName)) {
        throw new Error(`page ${page.route} names loop ${page.loopName}, which no subcategory declares`);
      }
      if (!pagesByLoop.has(page.loopName)) pagesByLoop.set(page.loopName, []);
      pagesByLoop.get(page.loopName)!.push(i);
    }
  });

  /** The screen carrying this loop's `CollectionItemManager`, wherever it is. */
  function hubScreenOf(loopName: string): number | null {
    const found = screens.findIndex((s) =>
      s.content.some(
        (c) => c.componentName === `CollectionItemManager` && (c.props as { loopName?: string }).loopName === loopName
      )
    );
    return found === -1 ? null : found;
  }

  const plans = new Map<string, LoopPlan>();
  for (const [loopName, pageIndices] of pagesByLoop) {
    const loop = declared.get(loopName)!;

    const contiguous = pageIndices.every((v, i) => i === 0 || v === pageIndices[i - 1] + 1);
    if (!contiguous) {
      throw new Error(
        `loop ${loopName} has pages ${pageIndices.join(`, `)}, which are not one run. Collapsing them into ` +
          `one <fg-collection> would move the pages between them.`
      );
    }

    const first = pageIndices[0];
    const hubScreen = hubScreenOf(loopName);

    if (loop.autoIterate) {
      if (hubScreen !== null) {
        throw new Error(
          `loop ${loopName} auto-iterates ${loop.collectionName} but has a CollectionItemManager. A derived ` +
            `collection cannot be added to, so it cannot have a hub — recheck what upstream changed.`
        );
      }
      plans.set(loopName, { ...loop, pageIndices, anchorPage: first, hubScreen: null });
      continue;
    }

    if (hubScreen === null) {
      throw new Error(`loop ${loopName} iterates ${loop.collectionName} by hand but has no CollectionItemManager`);
    }
    const hubPage = pages.findIndex((p) => p.screenIndices.includes(hubScreen));
    if (hubPage !== first - 1) {
      throw new Error(
        `loop ${loopName}'s hub is on page ${pages[hubPage]?.route} (${hubPage}) but its first loop page is ` +
          `${pages[first].route} (${first}). The collection is emitted on the hub, which has to be the page ` +
          `before it, or the loop's questions would move.`
      );
    }
    plans.set(loopName, { ...loop, pageIndices, anchorPage: hubPage, hubScreen });
  }

  return plans;
}

/** `/cdccQualifyingPeople` → `cdcc qualifying people`. A placeholder; see `itemNameFor` in extract.ts. */
function humanizeCollection(collectionName: string): string {
  return collectionName
    .replace(/^\//, ``)
    .replace(/([A-Z]+)([A-Z][a-z])/g, `$1 $2`)
    .replace(/([a-z0-9])([A-Z])/g, `$1 $2`)
    .toLowerCase();
}

function emit(extracted: Extracted, resourcesDir: string) {
  const { screens, pages } = extracted;

  const loops = planLoops(extracted);

  /** page index → the loop whose `<fg-collection>` is emitted there. */
  const anchors = new Map<number, LoopPlan>();
  /** page indices whose screens are emitted inside a collection rather than as the page's own. */
  const absorbed = new Map<number, LoopPlan>();
  for (const plan of loops.values()) {
    anchors.set(plan.anchorPage, plan);
    for (const i of plan.pageIndices) absorbed.set(i, plan);
  }

  const gateSet = new GateSet();
  const droppedPages: { page: string; because: string }[] = [];
  const componentTypes = new Map<string, number>();
  const knockouts: string[] = [];

  /** subcategory route → the XML of its pages, in order. */
  const modules = new Map<string, string[]>();

  /** One screen as a `<div class="df-screen">`, or null if its conditions fold to false. */
  function screenBlock(screen: ExtractedScreen, loopCollection: string | null, indent: string): string | null {
    for (const c of screen.content) componentTypes.set(c.componentName, (componentTypes.get(c.componentName) ?? 0) + 1);

    const resolved: ScreenGate = gateSet.resolve(screen.conditions, {
      collectionContext: screen.collectionContext,
      loopCollection,
      screenRoute: screen.screenRoute,
    });
    if (resolved.kind === `never`) return null;
    if (screen.isKnockout) knockouts.push(screen.screenRoute);

    const gateAttrs =
      resolved.kind === `gate` ? ` condition="${xmlAttr(resolved.gate.conditionPath)}" operator="isTrue"` : ``;
    const classes = screen.isKnockout ? `df-screen df-knockout` : `df-screen`;

    return (
      `${indent}<div class="${classes}"${gateAttrs}>\n` +
      `${indent}  <h2>${xmlText(screen.route)}</h2>\n` +
      `${indent}  <p>${xmlText(componentSummary(screen))}</p>\n` +
      `${indent}</div>`
    );
  }

  for (const [i, page] of pages.entries()) {
    const anchored = anchors.get(i) ?? null;
    // Absorbed and not the anchor: these screens are emitted inside the anchor's collection.
    if (absorbed.has(i) && !anchored) continue;

    // The hub's own screens sit above the collection; an auto-iterating loop's anchor *is* a loop
    // page, so it has none of its own.
    const ownScreens = absorbed.has(i) ? [] : page.screenIndices.map((j) => screens[j]);
    const blocks = ownScreens.map((s) => screenBlock(s, null, `      `)).filter((b): b is string => b !== null);

    let collection = ``;
    if (anchored) {
      const inner = anchored.pageIndices
        .flatMap((j) => pages[j].screenIndices)
        .map((j) => screenBlock(screens[j], anchored.collectionName, `        `))
        .filter((b): b is string => b !== null);

      if (inner.length > 0) {
        // The collection shows exactly when its hub screen does. Every screen inside carries the same
        // ancestor conditions already; this is what keeps the shell — the heading and the Add button —
        // from standing on a page upstream would have skipped.
        const hubGate = anchored.hubScreen === null ? null : gateSet.gateFor(screens[anchored.hubScreen].screenRoute);
        const itemName = anchored.itemName ?? humanizeCollection(anchored.collectionName);
        const attrs =
          `path="${xmlAttr(anchored.collectionName)}" item-name="${xmlAttr(itemName)}"` +
          (anchored.autoIterate ? ` readonly="true"` : ` determiner="another"`) +
          (hubGate ? ` if-true="${xmlAttr(hubGate)}"` : ``);
        collection = `      <fg-collection ${attrs}>\n${inner.join(`\n`)}\n      </fg-collection>`;
      }
    }

    const body = [...blocks, collection].filter((part) => part.length > 0).join(`\n`);
    if (body.length === 0) {
      droppedPages.push({ page: page.route, because: `every screen on it folded away` });
      continue;
    }

    const route = stripFlow(page.route);
    const title = humanize(route.split(`/`).pop() ?? route);

    const xml =
      `  <page title="${xmlAttr(title)}" route="${xmlAttr(route)}">\n` +
      `    <section>\n${body}\n    </section>\n` +
      `  </page>`;

    const slug = moduleSlug(page.subcategoryRoute);
    if (!modules.has(slug)) modules.set(slug, []);
    modules.get(slug)!.push(xml);
  }

  const pagesEmitted = [...modules.values()].reduce((n, xs) => n + xs.length, 0);

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

  // Two checks on files the transpiler does not own but whose contents it decides the shape of.
  // Both fail here, naming the key or the path, rather than shipping a page that reads wrong.
  const headings = declaredSectionHeadings(resourcesDir);
  const unheaded = moduleOrder.filter((slug) => !headings.has(slug));
  if (unheaded.length > 0) {
    throw new Error(
      `${unheaded.length} flow module(s) have no Browse All heading. Add to locales/en.yaml (and ` +
        `es.yaml) under all-screens.section:\n  ${unheaded.join(`\n  `)}`
    );
  }

  const missingWorkspaceFacts = [...new Set(workspaceFactPaths(resourcesDir))].filter((p) => !declared.has(p));
  if (missingWorkspaceFacts.length > 0) {
    throw new Error(
      `the workspace's determinations name ${missingWorkspaceFacts.length} fact(s) the dictionary does not ` +
        `declare, so the Outcome tracker would show them blank forever:\n  ${missingWorkspaceFacts.join(`\n  `)}`
    );
  }

  const manifest: Manifest = {
    $comment:
      `GENERATED by src/scripts/to-form-builder. What the transpiler mapped, what it dropped and ` +
      `why, and what stage 4 still owes. An unmapped construct must never quietly vanish from 727 screens.`,
    counts: {
      screensIn: screens.length,
      screensEmitted: screens.length - gateSet.dropped.length,
      pagesIn: pages.length,
      pagesEmitted,
      // Absorbed into a <fg-collection> on another page rather than dropped: the loop's screens are
      // all still here, and 11 of the 19 land on a hub page that already existed.
      pagesAbsorbedIntoCollections: absorbed.size - anchors.size,
      collections: [...anchors.values()].length,
      readonlyCollections: [...anchors.values()].filter((p) => p.autoIterate).length,
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
        `Stage 4, for ${[...anchors.values()].filter((p) => !p.itemName).length} of the ` +
        `${anchors.size} collections. The rest take the noun out of upstream's own Add control ` +
        `(\`fields.{collection}.controls.add\`). An auto-iterating loop has no such key, because ` +
        `upstream never names those items — it renders no list and no Add button over a derived ` +
        `collection — so those fall back to the humanized collection path and owe a real word.`,
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
