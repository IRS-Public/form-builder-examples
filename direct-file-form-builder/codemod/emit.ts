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
import { dirname, resolve, join } from 'path';
import { ALWAYS_TRUE_PATH, GateSet, renderGateFacts, type RawScreenCondition, type ScreenGate } from './gates.ts';
import { FactTypes } from './fact-types.ts';
import type { Block, ContentReport, Inline, ModalDialog, ScreenContent } from './content.ts';
import { renderCoverage } from './coverage.ts';
import { plainText, renderBlocks, renderInline, renderModals, xmlAttr as attr, type RenderContext } from './render.ts';

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

/**
 * Whether the dictionary can reach a path — directly, or through a fact that stands for a collection
 * item.
 *
 * `/primaryFiler/hasIpPin` is not declared anywhere: `/primaryFiler` is a `<Find>` over `/filers`,
 * and what is declared is `/filers/*\/hasIpPin`. The same shape appears without the alias being at
 * the root — `/formW2s/*\/filer/isPrimaryFiler` reads through `/formW2s/*\/filer`, and
 * `/firstHohQP/isClaimedDependent` through `/firstHohQP`. So the rule is: a path is reachable if it
 * is declared, or if some prefix of it is.
 *
 * That prefix rule is deliberately weaker than an exact match, and worth being honest about: a typo
 * *after* a valid alias passes this check and fails in the Fact Graph instead. What this exists to
 * catch is a path whose root does not exist at all, which is the failure that otherwise surfaces
 * several frames from anything naming the flow condition that caused it.
 */
function isDeclared(path: string, declared: Set<string>): boolean {
  if (declared.has(path)) return true;
  const segments = path.split(`/`);
  for (let end = segments.length - 1; end > 1; end--) {
    if (declared.has(segments.slice(0, end).join(`/`))) return true;
  }
  return false;
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

const xmlAttr = attr;

/** The content stage 4 resolved, keyed by screen route. Written beside flow-config.json. */
interface Content {
  screens: Record<string, ScreenContent>;
  /** Direct File's short nav label per sub-subcategory route. See resolveContent in extract.ts. */
  subSubcategoryTitles: Record<string, string>;
  report: ContentReport;
}

interface Manifest {
  $comment: string;
  counts: Record<string, number>;
  droppedScreens: { screen: string; because: string }[];
  droppedPages: { page: string; because: string }[];
  /** Every content component type met, and how many screens carry it. Stage 4's worklist. */
  componentTypes: Record<string, number>;
  /** What stage 4 could not resolve or could not express, with counts. */
  content: {
    missingKeys: number;
    unhandledInline: Record<string, number>;
    flattenedOptionLabels: number;
    render: Record<string, number>;
    screensWithoutContent: string[];
  };
  /** Constructs the transpiler records rather than expresses, each with where it will be handled. */
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

const WILDCARD = /^(\/[A-Za-z0-9]+)\/\*\//;

/**
 * Put every fact path in a screen's content into a scope the page can resolve.
 *
 * The rewrite is `gates.ts`'s `scopePath`, applied to the paths the content names rather than the
 * paths its conditions do — and it is needed for the same reason. `configureCollectionIds` rewrites
 * `/*\/` only inside an `<fg-collection>`; a wildcard path on a page with no collection has no item
 * to resolve against. Direct File resolves those from the screen's `collectionContext`, which for
 * all 52 of them is `/primaryFiler` or `/secondaryFiler` — `<Find>` facts returning one filer.
 *
 * Anything else is left alone and counted: leaving it is what makes the failure visible in the build
 * rather than silently pointing at the wrong item.
 */
function rewritePaths(
  blocks: Block[],
  screen: ExtractedScreen,
  loopCollection: string | null,
  counts: Record<string, number>
): Block[] {
  const rewrite = (path: string): string => {
    const match = WILDCARD.exec(path);
    if (!match) return path;
    // Inside a collection, any wildcard resolves: `configureCollectionIds` rewrites every `/*\/` on
    // the cloned item regardless of which collection names it, and a derived collection's ids are
    // the underlying collection's — which is what makes `/filers/*\/x` correct inside
    // `<fg-collection path="/filersWithHsa">`.
    if (loopCollection !== null) return path;
    const filer = screen.collectionContext;
    if (match[1] === `/filers` && (filer === `/primaryFiler` || filer === `/secondaryFiler`)) {
      return path.replace(WILDCARD, `${filer}/`);
    }
    counts[`wildcardPathsWithNoItem`] = (counts[`wildcardPathsWithNoItem`] ?? 0) + 1;
    return path;
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== `object`) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = key === `path` || key === `source` ? rewrite(value as string) : walk(value);
    }
    return out;
  };
  return walk(blocks) as Block[];
}

/**
 * Mark a knockout screen's first alert as one.
 *
 * `knockout="true"` is what makes `<fg-alert>` block navigation, which is the whole of what Direct
 * File's `isKnockout` plus its `KnockoutButton` did — the button only ever went back. The first alert
 * is the message; a knockout screen with none keeps its content and simply does not block, which is
 * counted rather than papered over.
 */
function withKnockout(blocks: Block[], isKnockout: boolean): Block[] {
  if (!isKnockout) return blocks;
  const first = blocks.findIndex((block) => block.k === `alert`);
  if (first === -1) return blocks;
  return blocks.map((block, i) => (i === first ? { ...block, knockout: true, type: `error` } : block)) as Block[];
}

/** Whether two runs of inline nodes say the same thing, for the heading-as-label case. */
function sameInline(a: Inline[], b: Inline[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `/cdccQualifyingPeople` → `cdcc qualifying people`.
 *
 * The last resort, and no collection reaches it today: every one is named either by upstream's own
 * Add control or by `AUTO_ITERATED_ITEM_NAMES` in extract.ts. Kept, and counted below, so a
 * collection added upstream that neither source names shows up as a number here rather than as an
 * item heading reading "Cdcc qualifying people 1".
 */
function humanizeCollection(collectionName: string): string {
  return collectionName
    .replace(/^\//, ``)
    .replace(/([A-Z]+)([A-Z][a-z])/g, `$1 $2`)
    .replace(/([a-z0-9])([A-Z])/g, `$1 $2`)
    .toLowerCase();
}

function emit(extracted: Extracted, content: Content, resourcesDir: string) {
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
  let screensEmitted = 0;
  const renderCounts: Record<string, number> = {};
  /** Screen routes with no resolved content, which would be a stage-4 gap rather than an empty screen. */
  const screensWithoutContent: string[] = [];
  /**
   * Screen route → the gate that decides whether it shows, for `verify-visibility.ts`.
   *
   * `null` is always shown, `false` is folded away in this port, a string is the gate fact's path.
   * Written out because the check that the gates say what Direct File's conditions say cannot be
   * made by reading the XML: it needs the mapping the emitter had while it was deciding.
   */
  const screenGates: Record<string, string | null | false> = {};

  /** subcategory route → the XML of its pages, in order. */
  const modules = new Map<string, string[]>();
  /** Modals the current page's screens named, by id, so two screens share one dialog. */
  let pageModals = new Map<string, ModalDialog>();

  /**
   * One screen as a `<div class="df-screen">`, or null if its conditions fold to false.
   *
   * The div carries the screen's own gate; everything inside it is stage 4's content. A content
   * declaration may carry conditions of its own on top of the screen's, and those become their own
   * gate in the same scope — which is why the gate context is rebuilt here rather than passed down.
   */
  function screenBlock(screen: ExtractedScreen, loopCollection: string | null, indent: string): string | null {
    for (const c of screen.content) componentTypes.set(c.componentName, (componentTypes.get(c.componentName) ?? 0) + 1);

    const gateContext = {
      collectionContext: screen.collectionContext,
      loopCollection,
      screenRoute: screen.screenRoute,
    };
    const resolved: ScreenGate = gateSet.resolve(screen.conditions, gateContext);
    screenGates[screen.screenRoute] =
      resolved.kind === `never` ? false : resolved.kind === `always` ? null : resolved.gate.conditionPath;
    if (resolved.kind === `never`) return null;
    if (screen.isKnockout) knockouts.push(screen.screenRoute);

    const context: RenderContext = {
      gate: (conditions) => {
        if (conditions.length === 0) return null;
        const own = gateSet.resolve(conditions as RawScreenCondition[], { ...gateContext, recordDropped: false });
        return own.kind === `never` ? false : own.kind === `always` ? null : own.gate.conditionPath;
      },
      alwaysTrue: () => gateSet.alwaysTrue(),
      screenRoute: screen.screenRoute,
      counts: renderCounts,
    };

    const resolvedContent = content.screens[screen.screenRoute];
    if (resolvedContent === undefined) {
      screensWithoutContent.push(screen.screenRoute);
      return null;
    }
    for (const modal of resolvedContent.modals) if (!pageModals.has(modal.id)) pageModals.set(modal.id, modal);

    const blocks = rewritePaths(withKnockout(resolvedContent.blocks, screen.isKnockout), screen, loopCollection, renderCounts);
    screensEmitted += 1;
    const body = [
      ...renderSetActions(screen, indent, context),
      ...renderBlocks(blocks, `${indent}  `, context),
    ];

    // The heading is dropped when the screen's only content is the one question that borrowed it —
    // Direct File's `labelledBy: 'heading'`, where the heading *is* the label. Rendering both would
    // ask the same thing twice.
    const heading = resolvedContent.heading;
    const borrowed = blocks.length === 1 && blocks[0].k === `set` && sameInline(blocks[0].question, heading ?? []);
    const headingXml =
      heading === null || borrowed ? [] : [`${indent}  <h2>${renderInline(heading)}</h2>`];

    const gateAttrs =
      resolved.kind === `gate` ? ` condition="${xmlAttr(resolved.gate.conditionPath)}" operator="isTrue"` : ``;
    const classes = screen.isKnockout ? `df-screen df-knockout` : `df-screen`;
    const inner = [...headingXml, ...body];
    if (inner.length === 0) return null;

    return `${indent}<div class="${classes}"${gateAttrs}>\n${inner.join(`\n`)}\n${indent}</div>`;
  }

  /**
   * `<SetFactAction>`, as `<fg-apply source>`.
   *
   * `source` is a fact path, or one of two names that are not facts: `df.language` (the UI language,
   * which this port does not write into the graph) and `emptyCollection` (a literal the flow has no
   * way to spell). Both are counted and skipped. An action with conditions of its own is emitted
   * unconditionally when the screen has no gate to add them to — see `applyConditionsDropped`.
   */
  function renderSetActions(screen: ExtractedScreen, indent: string, context: RenderContext): string[] {
    const out: string[] = [];
    for (const raw of screen.setActions as { path: string; source: string; condition?: unknown; conditions?: unknown[] }[]) {
      if (!raw.source.startsWith(`/`)) {
        renderCounts[`setActionsWithoutAFactSource`] = (renderCounts[`setActionsWithoutAFactSource`] ?? 0) + 1;
        continue;
      }
      const own = [...(raw.condition === undefined ? [] : [raw.condition]), ...(raw.conditions ?? [])];
      if (own.length > 0) {
        const gate = context.gate(own);
        if (gate === false) continue;
        if (gate !== null) {
          renderCounts[`applyConditionsDropped`] = (renderCounts[`applyConditionsDropped`] ?? 0) + 1;
        }
      }
      out.push(`${indent}  <fg-apply path="${xmlAttr(raw.path)}" source="${xmlAttr(raw.source)}"/>`);
    }
    return out;
  }

  for (const [i, page] of pages.entries()) {
    const anchored = anchors.get(i) ?? null;
    // Absorbed and not the anchor: these screens are emitted inside the anchor's collection.
    if (absorbed.has(i) && !anchored) continue;
    pageModals = new Map();

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
      pageModals = new Map();
      continue;
    }

    const route = stripFlow(page.route);
    // The title, in the order it is worth having.
    //
    // Direct File's own sub-subcategory label first — "Your basic information", the words its side
    // nav uses — because a page is one sub-subcategory's worth of screens and that label is what
    // names it. Then the first screen's heading, which is the sentence Direct File shows on arrival
    // and the only name a page with no sub-subcategory has. Then the route segment, humanized.
    //
    // Fourteen sub-subcategories were cut into two pages each, because their screens are not
    // contiguous in the flow, and both halves take the same label. That is what Direct File's nav
    // shows too: the label names the topic, not the page.
    const firstHeading = content.screens[screens[page.screenIndices[0]].screenRoute]?.heading ?? null;
    const label = page.subSubcategoryRoute === null ? undefined : content.subSubcategoryTitles[page.subSubcategoryRoute];
    const title =
      label ?? (firstHeading === null ? humanize(route.split(`/`).pop() ?? route) : plainText(firstHeading));

    const modals = renderModals([...pageModals.values()], `    `, {
      gate: () => null,
      alwaysTrue: () => gateSet.alwaysTrue(),
      screenRoute: page.route,
      counts: renderCounts,
    });
    pageModals = new Map();

    const xml =
      `  <page title="${xmlAttr(title)}" route="${xmlAttr(route)}">\n` +
      `    <section>\n${body}\n    </section>\n` +
      (modals.length > 0 ? `${modals.join(`\n`)}\n` : ``) +
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
      if (!isDeclared(condition.path, declared)) {
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

  // The dictionary, read for what each condition's fact holds. `gates.ts` needs it to write a
  // truthiness test the Fact Graph accepts; see TRUTHINESS there for what each type turns into.
  const factTypes = new FactTypes(factsDir, [GATES_FILE]);
  writeFileSync(join(factsDir, GATES_FILE), renderGateFacts(gates, gateSet.needsAlwaysTrue, (p) => factTypes.kindOf(p)));

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
      screensEmitted,
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
    content: {
      missingKeys: content.report.missingKeys.length,
      unhandledInline: content.report.unhandledInline,
      droppedWithReason: content.report.droppedWithReason,
      flattenedOptionLabels: content.report.flattenedOptionLabels,
      render: renderCounts,
      screensWithoutContent,
      // Should stay 0. See humanizeCollection.
      collectionsWithNoItemName: [...anchors.values()].filter((p) => !p.itemName).length,
    },
    deferred: {
      'Spanish flow content':
        `Not stage 4's, and not a script run. flow_es.yaml is keyed by flow_en.yaml, which the ` +
        `scaffold regenerates from the emitted XML — so the keys exist only after a build. Direct ` +
        `File's own es.yaml has the translations, keyed the same way its en.yaml is; what is ` +
        `missing is the step that re-keys them. See docs/PORTING.md.`,
    },
    gates: {
      total: gates.length,
      rootScoped: gates.filter((g) => g.scope === null).length,
      collectionScoped: gates.filter((g) => g.scope !== null).length,
      sharedByMoreThanOneScreen: gates.filter((g) => g.screens.length > 1).length,
    },
  };
  writeFileSync(join(import.meta.dirname, `manifest.json`), JSON.stringify(manifest, null, 2) + `\n`);
  writeFileSync(join(import.meta.dirname, `screen-gates.json`), JSON.stringify(screenGates, null, 2) + `\n`);
  // Stage 5's readable half. The manifest is what a script diffs; this is what a reviewer reads.
  writeFileSync(join(import.meta.dirname, `component-coverage.md`), renderCoverage(content.report, screens.length));

  return manifest;
}

const configPath = resolve(process.argv[2] ?? join(import.meta.dirname, `flow-config.json`));
const resourcesDir = resolve(process.argv[3] ?? join(import.meta.dirname, `../src/main/resources/direct-file`));
const contentPath = join(dirname(configPath), `content.json`);
const manifest = emit(
  JSON.parse(readFileSync(configPath, `utf8`)) as Extracted,
  JSON.parse(readFileSync(contentPath, `utf8`)) as Content,
  resourcesDir
);

console.log(`wrote ${resourcesDir}/flow/ and facts/flowGates.xml`);
for (const [name, count] of Object.entries(manifest.counts)) console.log(`  ${name.padEnd(20)} ${count}`);
console.log(`  gates                ${manifest.gates.total} (${manifest.gates.collectionScoped} collection-scoped)`);
console.log(`  dropped screens      ${manifest.droppedScreens.length}`);
console.log(`  dropped pages        ${manifest.droppedPages.length}`);
for (const [name, count] of Object.entries(manifest.content.render)) console.log(`  ${name.padEnd(20)} ${count}`);
