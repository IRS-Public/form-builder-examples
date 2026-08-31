/**
 * Stage 1 of the Direct File → Form Builder transpiler: the flow, as JSON.
 *
 * Direct File already ships the compiler. `createFlowConfig(flowNodes)` walks the JSX tree in
 * flow.tsx once and returns a plain object graph — every screen with its ancestor `<Gate>`s already
 * flattened onto it as `conditions`, its `content` declarations with raw props intact, and its
 * `setActions` extracted. `src/test/scenarioTests/flowSnapshots.test.ts` uses the same entry point.
 *
 * So this stage parses no JSX and walks no AST. It runs the app's own compiler and serialises what
 * comes out, which is why gate flattening — the thing the topic-page collapse depends on — arrives
 * free and correct rather than reimplemented.
 *
 * Everything downstream reads this file rather than the React app, so the later stages are testable
 * without a DOM and reviewable as a diff when upstream moves.
 *
 * ## Ordering
 *
 * `flow.screens` is the ground truth, and the only ground truth. `parseFlowRecursive` is a
 * depth-first walk over `Children.forEach`, and every container is built by `push`, so that array is
 * exactly the order the JSX declares — which is exactly the order Direct File navigates.
 *
 * The nested containers are NOT a safe substitute, and reassembling page order from them is wrong in
 * two measured ways:
 *
 *   1. `addSubSubcategory` early-returns on a `fullRoute` it has already seen, so a SubSubcategory
 *      declared in two places in the JSX is merged into the first one. 14 of them are, and their
 *      `screens` arrays are therefore NOT contiguous in flow order —
 *      `spouse/spouse-basic-info` holds screens 60, 61 and 94. Emitting one page per SubSubcategory
 *      would render screen 94 thirty-four screens early.
 *   2. 86 screens belong to no SubSubcategory at all — intros, breathers, knockout landings. A
 *      per-SubSubcategory emit drops every one of them.
 *
 * So pages are cut from **runs** of the global order instead: a new run begins wherever the
 * subcategory, the SubSubcategory or the collection loop changes. 727 screens become 218 runs. Two
 * invariants are asserted below rather than assumed, and the extraction fails if either breaks:
 * concatenating the runs reproduces `flow.screens` exactly, and every screen appears in exactly one.
 *
 *     make transpile   (or: vite-node --root <df-client-app> codemod/extract.ts <outfile>)
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import en from '/src/locales/en.yaml';
import flowNodes from '/src/flow/flow.js';
import { createFlowConfig } from '/src/flow/flowConfig.js';
import type { FlowConfig, FlowSubcategory, FlowSubSubcategory, FlowCollectionLoop } from '/src/flow/flowConfig.js';
import type { ScreenConfig } from '/src/flow/ScreenConfig.js';
import { Resolver, type ComponentCategory, type ContentReport, type Inline, type ScreenContent } from './content.ts';
import {
  ComponentMapper,
  NOT_EXPRESSIBLE,
  OUT_OF_SCOPE,
  RENDERED_ELSEWHERE,
  type ContentConfig,
} from './components.ts';

/** One screen, reduced to what the emitter needs. */
interface ExtractedScreen {
  route: string;
  screenRoute: string;
  categoryRoute: string;
  subcategoryRoute: string;
  subSubcategoryRoute: string;
  /** Ancestor <Gate>s, already flattened onto the screen by createFlowConfig. ANDed. */
  conditions: unknown[];
  collectionContext: string | null;
  collectionLoop: ScreenConfig['collectionLoop'] | null;
  isKnockout: boolean;
  actAsDataView: boolean;
  hasScreenRouteOverride: boolean;
  routeAutomatically: boolean;
  alertAggregatorType?: string;
  /** Every content declaration, `componentName` plus its raw props. */
  content: { componentName: string; props: unknown }[];
  setActions: unknown[];
  factPaths: string[];
}

function extractScreen(screen: ScreenConfig): ExtractedScreen {
  return {
    route: screen.route,
    screenRoute: screen.screenRoute,
    categoryRoute: screen.categoryRoute,
    subcategoryRoute: screen.subcategoryRoute,
    subSubcategoryRoute: screen.subSubcategoryRoute,
    conditions: screen.conditions as unknown[],
    collectionContext: (screen.collectionContext as string | undefined) ?? null,
    collectionLoop: screen.collectionLoop ?? null,
    isKnockout: screen.isKnockout,
    actAsDataView: screen.actAsDataView,
    hasScreenRouteOverride: screen.hasScreenRouteOverride,
    routeAutomatically: screen.routeAutomatically,
    alertAggregatorType: screen.alertAggregatorType,
    content: screen.content.map((c) => ({
      componentName: c.componentName,
      props: c.props as unknown,
    })),
    setActions: screen.setActions as unknown[],
    factPaths: screen.factPaths as string[],
  };
}

function extractSubSubcategory(ssc: FlowSubSubcategory) {
  return {
    fullRoute: ssc.fullRoute,
    routeSuffix: ssc.routeSuffix,
    subcategoryRoute: ssc.subcategoryRoute,
    loopName: ssc.loopName ?? null,
    hidden: ssc.hidden ?? false,
    editable: ssc.editable ?? null,
    borderStyle: ssc.borderStyle ?? null,
    headingLevel: ssc.headingLevel ?? null,
  };
}

/**
 * What one item of a collection is called, in words — `person`, `W-2`, `care provider`.
 *
 * `<fg-collection item-name>` needs it for the Add button ("Add another **W-2**") and the item
 * heading, and Direct File already has the string: the hub screen's Add control reads
 * `fields.{collection}.controls.add`, which is that sentence. Stripping the leading verb leaves the
 * noun, and the library composes its own button text around it.
 *
 * Null for an auto-iterating loop, and not a gap in this function: upstream has no such key for one
 * because upstream never names those items — it renders no list, no Add button and no Remove
 * control over a derived collection. Stage 4 owes them a word.
 */
function itemNameFor(collectionName: string): string | null {
  const add = (en as Record<string, any>).fields?.[collectionName]?.controls?.add;
  if (typeof add !== `string`) return null;
  const name = add.replace(/^Add\s+/, ``).trim();
  return name.length > 0 && name !== add ? name : null;
}

function extractLoop(loop: FlowCollectionLoop) {
  return {
    loopName: loop.loopName,
    itemName: itemNameFor(loop.collectionName as string),
    fullRoute: loop.fullRoute,
    subcategoryRoute: loop.subcategoryRoute,
    collectionName: loop.collectionName as string,
    autoIterate: loop.autoIterate,
    isInner: loop.isInner,
    donePath: (loop.donePath as string | undefined) ?? null,
    knockoutRoute: loop.knockoutRoute ?? null,
    collectionItemCompletedCondition: loop.collectionItemCompletedCondition ?? null,
    // Deliberately dropped, and named here so the manifest can say so: the hub's card sections are
    // a Checklist/DataView surface, and the port's topic page *is* the review surface.
    droppedDataViewSections: loop.dataViewSections?.length ?? 0,
    subSubcategories: loop.subSubcategories.map(extractSubSubcategory),
  };
}

function extractSubcategory(sub: FlowSubcategory) {
  return {
    route: sub.route,
    categoryRoute: sub.categoryRoute,
    collectionName: (sub.collectionName as string | undefined) ?? null,
    hasDataView: sub.hasDataView,
    isSignAndSubmit: sub.isSignAndSubmit ?? false,
    displayOnlyIf: sub.displayOnlyIf ?? null,
    subSubcategories: sub.subSubcategories.map(extractSubSubcategory),
    loops: sub.loops.map(extractLoop),
    // No screen list and no order here on purpose. Both live in the top-level `screens` and `pages`
    // arrays, which are cut from the global declaration order; a second ordering in the nested tree
    // would be a second thing to keep right, and the wrong one to reach for.
  };
}

/** One emitted page: a contiguous run of the declaration order under one heading. */
interface Page {
  route: string;
  categoryRoute: string;
  subcategoryRoute: string;
  subSubcategoryRoute: string | null;
  loopName: string | null;
  /** Indices into the top-level `screens` array. Contiguous, ascending, and the render order. */
  screenIndices: number[];
  /** True when this SubSubcategory is declared more than once and so cuts more than one page. */
  fromSplitSubSubcategory: boolean;
}

/**
 * Cut the declaration order into pages.
 *
 * A run ends where the subcategory, the SubSubcategory or the collection loop changes. That is the
 * finest cut that never reorders a screen, and the coarsest that never puts two unrelated headings
 * on one page.
 */
function cutPages(screens: ScreenConfig[]): Page[] {
  const runs: Page[] = [];
  let previousKey: string | null = null;

  screens.forEach((screen, index) => {
    const subSubcategoryRoute = screen.subSubcategoryRoute || null;
    const loopName = screen.collectionLoop?.loopName ?? null;
    const key = `${screen.subcategoryRoute}|${subSubcategoryRoute}|${loopName}`;

    if (key === previousKey) {
      runs[runs.length - 1].screenIndices.push(index);
      return;
    }
    previousKey = key;
    runs.push({
      route: ``,
      categoryRoute: screen.categoryRoute,
      subcategoryRoute: screen.subcategoryRoute,
      subSubcategoryRoute,
      loopName,
      screenIndices: [index],
      fromSplitSubSubcategory: false,
    });
  });

  // Route each run, collision-free by construction rather than by suffixing afterwards.
  //
  // A run's first screen names it in every ambiguous case, because screen routes are globally unique
  // — `addScreen` throws on a duplicate — and each run has a different first screen. A
  // SubSubcategory route is used only where it is unambiguous, which is the readable majority.
  //
  // Two things make a SubSubcategory route ambiguous, and both are real here:
  //
  //   - It cut more than one run, because it is declared in more than one place in the JSX. 14 are.
  //   - It is *also* a screen route. Six are, `income/hsa/hsa-intro` among them: upstream keeps
  //     screens and SubSubcategories in separate namespaces (`/flow/…` against `/data-view/…`) and
  //     this port collapses them into one, so a clash that means nothing there would silently
  //     overwrite a page here.
  const runsPerSubSubcategory = new Map<string, number>();
  for (const run of runs) {
    if (!run.subSubcategoryRoute) continue;
    runsPerSubSubcategory.set(run.subSubcategoryRoute, (runsPerSubSubcategory.get(run.subSubcategoryRoute) ?? 0) + 1);
  }
  const screenRoutes = new Set(screens.map((s) => s.screenRoute));

  for (const run of runs) {
    const firstScreenRoute = screens[run.screenIndices[0]].screenRoute;
    const ssc = run.subSubcategoryRoute;
    const split = ssc !== null && runsPerSubSubcategory.get(ssc)! > 1;
    run.fromSplitSubSubcategory = split;
    run.route = ssc !== null && !split && !screenRoutes.has(ssc) ? ssc : firstScreenRoute;
  }

  return runs;
}

/**
 * The two things that make this an ordering guarantee rather than an ordering hope.
 *
 * Both are cheap, and both would have caught the bug that motivated them: a per-SubSubcategory emit
 * silently reorders 14 SubSubcategories' screens and silently drops 86 others.
 */
function assertOrderIsPreserved(screens: ScreenConfig[], pages: Page[]) {
  const emitted = pages.flatMap((page) => page.screenIndices);

  const outOfOrder = emitted.findIndex((index, i) => index !== i);
  if (outOfOrder !== -1) {
    throw new Error(
      `pages do not reproduce the flow's declaration order: position ${outOfOrder} holds screen ` +
        `${emitted[outOfOrder]} (${screens[emitted[outOfOrder]]?.screenRoute}), expected screen ` +
        `${outOfOrder} (${screens[outOfOrder]?.screenRoute})`
    );
  }
  if (emitted.length !== screens.length) {
    const seen = new Set(emitted);
    const missing = screens.filter((_, i) => !seen.has(i)).map((s) => s.screenRoute);
    throw new Error(
      `${screens.length - emitted.length} screen(s) reached no page: ${missing.slice(0, 10).join(`, `)}`
    );
  }

  // Every page must be one contiguous run, or "the order is preserved" is true only globally and a
  // reader of one page still sees screens out of sequence.
  for (const page of pages) {
    const contiguous = page.screenIndices.every((v, i) => i === 0 || v === page.screenIndices[i - 1] + 1);
    if (!contiguous) {
      throw new Error(`page ${page.route} is not a contiguous run: [${page.screenIndices.join(`, `)}]`);
    }
  }

  const routes = pages.map((p) => p.route);
  const duplicates = routes.filter((r, i) => routes.indexOf(r) !== i);
  if (duplicates.length > 0) {
    throw new Error(`duplicate page routes, which would silently overwrite: ${[...new Set(duplicates)].join(`, `)}`);
  }
}

function extract(flow: FlowConfig) {
  const pages = cutPages(flow.screens);
  assertOrderIsPreserved(flow.screens, pages);

  return {
    $comment:
      `Generated by src/scripts/to-form-builder/extract.ts from flow.tsx via createFlowConfig(). ` +
      `Do not edit: regenerate.`,
    $ordering:
      `\`screens\` is the flow's declaration order and the only ordering source. \`pages\` cuts it ` +
      `into contiguous runs; concatenating page.screenIndices reproduces \`screens\` exactly. The ` +
      `nested \`categories\` tree carries labels and loop configuration only, and deliberately holds ` +
      `no screens.`,
    counts: {
      categories: flow.categories.length,
      subcategories: flow.subcategoriesByRoute.size,
      subSubcategories: flow.subsubcategoriesByRoute.size,
      collectionLoops: flow.collectionLoopsByName.size,
      screens: flow.screens.length,
      knockoutScreens: flow.screens.filter((s) => s.isKnockout).length,
      pages: pages.length,
      pagesWithNoSubSubcategory: pages.filter((p) => !p.subSubcategoryRoute).length,
      pagesFromSplitSubSubcategories: pages.filter((p) => p.fromSplitSubSubcategory).length,
    },
    screens: flow.screens.map(extractScreen),
    pages,
    categories: flow.categories.map((cat) => ({
      route: cat.route,
      subcategories: cat.subcategories.map(extractSubcategory),
    })),
  };
}

/** Which group a component type belongs to, read off the three tables `components.ts` declares. */
function categoryOf(name: string): ComponentCategory {
  if (Object.hasOwn(OUT_OF_SCOPE, name)) return `out-of-scope`;
  if (Object.hasOwn(NOT_EXPRESSIBLE, name)) return `not-expressible`;
  if (Object.hasOwn(RENDERED_ELSEWHERE, name)) return `rendered-elsewhere`;
  return `expressed`;
}

/**
 * A sub-subcategory label with its interpolations removed — "Basic information" for
 * `{{/familyAndHousehold/*\/firstName}}\u2019s basic information`.
 *
 * 25 of Direct File's 155 labels name the person or the year the page is about, and its side nav
 * fills them in per collection item. A Form Builder page title is a static attribute on `<page>`, so
 * there is nothing to fill them in with, and the honest rendering is the label without them: the
 * topic, minus the personalisation. This is a real difference from upstream and is recorded as one
 * in codemod/README.md rather than papered over.
 *
 * The tidying is deliberately small: drop the interpolation and any possessive stuck to it, drop a
 * preposition or `#` left dangling at either end, collapse the spaces, and capitalise what is left.
 */
function depersonalize(label: string): string {
  const stripped = label
    .replace(/\{\{[^}]*\}\}(\u2019s|'s)?/g, ` `)
    .replace(/\s+/g, ` `)
    .replace(/^[\s\u2019'#,-]+|[\s#,-]+$/g, ``)
    .replace(/\s+(to|in|for|with|of|and)$/i, ``)
    .trim();
  return stripped.length === 0 ? label : stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * Stage 4, driven per screen: the content of every screen, resolved once.
 *
 * Written beside `flow-config.json` rather than into it. The two answer different questions — one is
 * the flow's shape, the other its words — and a change to Direct File's copy should show up as a
 * diff of the second alone. `emit.ts` reads both.
 */
function resolveContent(
  screens: ExtractedScreen[],
  pages: Page[]
): {
  screens: Record<string, ScreenContent>;
  subSubcategoryTitles: Record<string, string>;
  report: ContentReport;
} {
  const resolver = new Resolver();
  const mapper = new ComponentMapper(resolver);
  const byScreen: Record<string, ScreenContent> = {};

  for (const screen of screens) {
    // The Heading is the screen's title and, for the first screen of a page, the page's. It is
    // resolved before the rest because a fact control with no label of its own borrows it.
    const headingConfig = screen.content.find((c) => c.componentName === `Heading`);
    const headingKey = headingConfig ? ((headingConfig.props as { i18nKey?: string }).i18nKey ?? null) : null;
    let heading: Inline[] = [];
    if (headingKey !== null) {
      heading = resolver.isModal(headingKey) ? resolver.modalInline(headingKey) : resolver.inlineForKey(headingKey);
    }

    const context = { screenRoute: screen.screenRoute, heading };
    const blocks = screen.content.flatMap((config) => mapper.blocks(config as ContentConfig, context));

    byScreen[screen.screenRoute] = {
      heading: heading.length > 0 ? heading : null,
      blocks,
      modals: resolver.takeModals(),
    };
  }

  // Direct File's own short nav label for each sub-subcategory — "Your basic information" rather
  // than the question sentence its first screen opens with. `en.yaml` keys them under the
  // subcategory they sit in, so the key is the subcategory route plus the sub-subcategory's own
  // last segment. A page with no sub-subcategory (48 of them) has no label and keeps its heading.
  const subSubcategoryTitles: Record<string, string> = {};
  for (const page of pages) {
    const route = page.subSubcategoryRoute;
    if (route === null || route in subSubcategoryTitles) continue;
    const title = resolver.lookupValue(`subsubcategories.${page.subcategoryRoute}.${route.split(`/`).pop()}`);
    if (typeof title === `string`) subSubcategoryTitles[route] = depersonalize(title);
  }

  const components: ContentReport[`components`] = {};
  for (const [name, dispositions] of mapper.dispositions) {
    components[name] = {
      category: categoryOf(name),
      dispositions: [...dispositions]
        .map(([disposition, count]) => ({ disposition, count }))
        .sort((a, b) => b.count - a.count),
      screens: mapper.screensPerComponent.get(name) ?? 0,
    };
  }

  return {
    screens: byScreen,
    subSubcategoryTitles,
    report: {
      components,
      missingKeys: [...resolver.missingKeys].sort(),
      unhandledInline: Object.fromEntries([...resolver.unhandledInline].sort((a, b) => b[1] - a[1])),
      flattenedOptionLabels: resolver.flattenedOptionLabels,
    },
  };
}

const outfile = resolve(process.argv[2] ?? `./flow-config.json`);
const flow = createFlowConfig(flowNodes);
const extracted = extract(flow);

mkdirSync(dirname(outfile), { recursive: true });
writeFileSync(outfile, JSON.stringify(extracted, null, 2) + `\n`);

const content = resolveContent(extracted.screens, extracted.pages);
const contentFile = join(dirname(outfile), `content.json`);
writeFileSync(contentFile, JSON.stringify(content, null, 2) + `\n`);

console.log(`wrote ${outfile}`);
for (const [name, count] of Object.entries(extracted.counts)) {
  console.log(`  ${name.padEnd(20)} ${count}`);
}
console.log(`wrote ${contentFile}`);
console.log(`  component types      ${Object.keys(content.report.components).length}`);
console.log(`  missing keys         ${content.report.missingKeys.length}`);
console.log(`  unhandled inline     ${Object.values(content.report.unhandledInline).reduce((a, b) => a + b, 0)}`);
console.log(`  page titles          ${Object.keys(content.subSubcategoryTitles).length} from subsubcategory labels`);
