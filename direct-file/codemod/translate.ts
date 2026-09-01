/**
 * Stage 15 of the transpiler: `locales/flow_es.yaml`, from Direct File's own Spanish.
 *
 * The translations exist and need no work. `df-client-app`'s `localeParity.test.ts` asserts that
 * `es.yaml` has a value for every key `en.yaml` has, with one exemption, so anything stage 4 resolved
 * out of `en` resolves out of `es` at the same key. What is missing is the re-keying, and the reason
 * it is not a one-line lookup is that **`flow_en.yaml`'s keys are not Direct File's keys.**
 *
 * `render.ts` prints literal English text into the flow XML; form-builder then parses that XML and
 * invents its own key for each leaf — `"$label-${md5(content).take(6)}"`, an MD5 of the *English*
 * words (`TranslationContext.getHashKey`). So there is no key in `flow_en.yaml` that is also a key in
 * Direct File's `en.yaml`, and "look the key up in `es.yaml`" does not typecheck.
 *
 * ## The join
 *
 * Stage 4 is run twice, over `en.yaml` and over `es.yaml` (`resolve-content.ts`), and each screen's
 * two block trees are printed by the same printer with its leaf recorder on. A leaf's address is
 * structural — `/2#1/0.question`, the shape of the tree rather than a position in it — so the two
 * walks are joined on the shape they share, and a subtree that resolves differently in one language
 * simply fails to pair and is counted.
 *
 * That gives, per page, a map from *the exact English text form-builder stored* to its Spanish. The
 * generated `flow_en.yaml` is then read back and each of its values looked up in that map. Which
 * means the pairing is validated by the English text itself: a value only takes a translation when
 * the transpiler can show it produced that same English on that same page.
 *
 * The plan for this stage specified a positional zip of the two orderings with the English text as an
 * assertion on top. This is that assertion used as the join rather than as a guard on one — the same
 * guarantee, minus the dependency on the codemod's walk order and form-builder's parse order staying
 * in step, which was the stage's named risk. Keys whose shape is not content-addressed (`title`, a
 * collection's `itemName`) are written straight to the key instead, since nothing has to be
 * recognised to find them.
 *
 * ## Why it cannot run with the rest of the transpiler
 *
 * Its input is the library's output. `make transpile` never invokes form-builder, so `flow_en.yaml`
 * does not exist until `make site` has run once — hence `make transpile-es`, after a build.
 *
 *     make transpile-es
 *     (or: vite-node --root <df-client-app> codemod/translate.ts <resources dir>)
 *
 * ## This is a bulk seed, not a replacement for syncTranslationLocales
 *
 * The hashed keys are content-addressed on the English text, so any later change to the flow — an
 * upstream content edit re-run through `make transpile`, or a hand-edit to this application's own
 * overrides — changes the hash and orphans that key's Spanish entry, exactly as it would for a
 * hand-written translation. form-builder's `syncTranslationLocales` is what carries a real edit
 * forward from there. This exists to get `flow_es.yaml` from empty to fully seeded out of upstream's
 * already-complete 26,939-line `es.yaml` in one pass.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import es from '/src/locales/es.yaml';
// The ESM build, reached the way content.ts reaches df-i18n: Vite's root is the Direct File client,
// so `/../node_modules/…` is the workspace's own node_modules. This is the only stage that needs a
// YAML parser, because it is the only one whose input is a file form-builder wrote.
import { dump, load } from '/../node_modules/js-yaml/dist/js-yaml.mjs';
import { ALWAYS_TRUE_PATH } from './gates.ts';
import { collectionItemName, resolveContent, type ResolvedContent } from './resolve-content.ts';
import type { Block, ModalDialog } from './content.ts';
import {
  pageTitle,
  renderBlocks,
  renderInline,
  renderModals,
  rewritePaths,
  type RenderContext,
} from './render.ts';

/** What `flow_en.yaml` holds: nested maps down to authored strings. */
type Tree = { [key: string]: string | Tree };

/** The marker `Locale.scala` writes for a key with no translation yet, and rewrites into a comment. */
const TODO_SENTINEL = `@@TODO_TRANSLATE@@`;
const TODO_COMMENT = `# TODO: translate`;

interface EmittedPage {
  route: string;
  module: string;
  subSubcategoryRoute: string | null;
  firstScreen: string;
  screens: string[];
  collection: { path: string; itemName: string; screens: string[] } | null;
}

interface FlowConfigScreen {
  screenRoute: string;
  collectionContext: string | null;
  content: { componentName: string; props: unknown }[];
}

interface FlowConfig {
  screens: FlowConfigScreen[];
  pages: { subcategoryRoute: string; subSubcategoryRoute: string | null }[];
}

// ── Comparing text across the two spellings of it ──────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: `&`,
  lt: `<`,
  gt: `>`,
  quot: `"`,
  apos: `'`,
  '#39': `'`,
};

/**
 * One authored string, in the one form both spellings of it agree on.
 *
 * The transpiler and form-builder escape differently on the way out. `xmlText` escapes `&`, `<` and
 * `>`; scala-xml re-serialises a parsed leaf's children with `Utility.escape`, which also escapes
 * `"` — 48 of this flow's values carry a `&quot;` the transpiler wrote as a bare quotation mark. And
 * the indentation inside a nested `<li>` is a property of where the printer was called from, not of
 * the words. Decoding the entities once and collapsing the whitespace makes the comparison about the
 * text rather than about either side's serialiser.
 */
function normalize(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (whole, name: string) => ENTITIES[name] ?? whole)
    .replace(/\s+/g, ` `)
    .trim();
}

// ── One page's English → Spanish map ───────────────────────────────────────────────────────────

interface Counts {
  /** Leaves whose address exists in English but not in Spanish, or the other way round. */
  unpairedLeaves: number;
  /**
   * One English text on one page whose two occurrences are translated differently upstream.
   *
   * Direct File writes the same English sentence under two keys — a screen and a modal, or two
   * phrasings of the same aside — and its Spanish translates each in its own words. Both are correct
   * Spanish for the same English, and *there is only one key here to put either under*, because
   * form-builder content-addresses on the English and has already collapsed the two. So this is not
   * a choice this stage makes that the library does not: the first occurrence on the page wins,
   * which is the same one that would have won had a person written the translation into the
   * generated file by hand.
   */
  ambiguousText: number;
  /** Screens with content in one language and not the other. Should be 0. */
  screensMissingContent: number;
}

class PageTranslations {
  /** normalized English → Spanish, for the leaves of one page. */
  private readonly byText = new Map<string, string>();
  private readonly counts: Counts;

  // Written out rather than a TypeScript parameter property: those need a transform, and everything
  // in here that does not import the Direct File checkout is expected to run under `node`'s
  // type stripping, which rejects them.
  constructor(counts: Counts) {
    this.counts = counts;
  }

  add(english: string, spanish: string) {
    const key = normalize(english);
    if (key.length === 0) return;
    const existing = this.byText.get(key);
    if (existing === undefined) {
      this.byText.set(key, spanish);
    } else if (existing !== spanish) {
      this.counts.ambiguousText += 1;
    }
  }

  get(english: string): string | undefined {
    return this.byText.get(normalize(english));
  }
}

/**
 * Every leaf one screen's content prints, addressed structurally.
 *
 * The printer is what knows what a leaf's stored value *is* — an `<li>` carries its nested list
 * inside its own value, an empty `<fg-alert>` heading becomes the literal "Note", a `<select>` option
 * is flattened where an enum option is not — so the recorder rides along with it rather than
 * re-deriving any of that. `gate` is stubbed to "always shown" because a condition changes an
 * attribute and not a word, and stubbing it identically for both languages keeps the two walks
 * aligned; the handful of blocks the real emit drops on a condition contribute a pair nothing looks
 * up.
 */
function leavesOf(
  blocks: Block[],
  modals: ModalDialog[],
  screenRoute: string,
  collectionContext: string | null,
  loopCollection: string | null
): Map<string, string> {
  const leaves = new Map<string, string>();
  const counts: Record<string, number> = {};
  const context: RenderContext = {
    gate: () => null,
    alwaysTrue: () => ALWAYS_TRUE_PATH,
    screenRoute,
    counts,
    record: (leaf) => {
      if (!leaves.has(leaf.path)) leaves.set(leaf.path, leaf.text);
    },
  };
  renderBlocks(rewritePaths(blocks, collectionContext, loopCollection, counts), ``, context);
  renderModals(modals, ``, context);
  return leaves;
}

/** The English and Spanish content of one screen, paired leaf by leaf into the page's map. */
function pairScreen(
  screenRoute: string,
  loopCollection: string | null,
  english: ResolvedContent,
  spanish: ResolvedContent,
  screensByRoute: Map<string, FlowConfigScreen>,
  into: PageTranslations,
  counts: Counts
) {
  const en = english.screens[screenRoute];
  const sp = spanish.screens[screenRoute];
  if (en === undefined || sp === undefined) {
    if (en !== undefined || sp !== undefined) counts.screensMissingContent += 1;
    return;
  }

  // The screen's own heading, which `emit.ts` prints as an `<h2>` outside the block list.
  if (en.heading !== null && sp.heading !== null) into.add(renderInline(en.heading), renderInline(sp.heading));

  const collectionContext = screensByRoute.get(screenRoute)?.collectionContext ?? null;
  const enLeaves = leavesOf(en.blocks, en.modals, screenRoute, collectionContext, loopCollection);
  const esLeaves = leavesOf(sp.blocks, sp.modals, screenRoute, collectionContext, loopCollection);

  for (const [address, text] of enLeaves) {
    const translated = esLeaves.get(address);
    if (translated === undefined) {
      counts.unpairedLeaves += 1;
      continue;
    }
    into.add(text, translated);
  }
  for (const address of esLeaves.keys()) if (!enLeaves.has(address)) counts.unpairedLeaves += 1;
}

// ── Writing one page's subtree ─────────────────────────────────────────────────────────────────

/** Why a key ended up with a TODO marker rather than a translation. Reported, and worth reading. */
type Gap = `no matching English` | `no Spanish title` | `no Spanish item name`;

interface PageResult {
  tree: Tree;
  translated: number;
  gaps: { key: string; gap: Gap; english: string }[];
  /** Values whose Spanish prints different facts, or opens a different modal, than its English. */
  drifted: number;
}

/** The parts of a value that are not words: the facts it prints and the modals it opens. */
function references(value: string): string {
  return [
    ...[...value.matchAll(/<fg-show\s+path="([^"]+)"/g)].map((m) => `fact ${m[1]}`),
    ...[...value.matchAll(/<modal-link\s+for="([^"]+)"/g)].map((m) => `modal ${m[1]}`),
  ]
    .sort()
    .join(` `);
}

function translatePage(subtree: Tree, page: EmittedPage, translations: PageTranslations, spanish: ResolvedContent): PageResult {
  const label =
    page.subSubcategoryRoute === null ? undefined : spanish.subSubcategoryTitles[page.subSubcategoryRoute];
  const heading = spanish.screens[page.firstScreen]?.heading ?? null;
  // The same three-way fallback `emit.ts` gave the English title, over the Spanish label and the
  // Spanish heading. The last resort — the route segment, humanized — is a slug and stays English,
  // which is what the `no Spanish title` gap counts.
  const title = label === undefined && heading === null ? null : pageTitle(label, heading, page.route, `es`);

  const itemName =
    page.collection === null ? null : collectionItemName(es, `es`, page.collection.path);

  let translated = 0;
  let drifted = 0;
  const gaps: PageResult[`gaps`] = [];

  const leaf = (key: string, at: string[], english: string): string => {
    const record = (value: string | null, gap: Gap): string => {
      if (value === null) {
        gaps.push({ key: [...at, key].join(`.`), gap, english });
        return TODO_SENTINEL + english;
      }
      translated += 1;
      if (references(value) !== references(english)) drifted += 1;
      return value;
    };

    // The two keys form-builder does not content-address. `title` comes off the `<page>` attribute
    // and `itemName` off `<fg-collection item-name>`, so both are found by name and neither needs
    // the English text recognised.
    if (at.length === 0 && key === `title`) return record(title, `no Spanish title`);
    if (at.length === 1 && key === `itemName` && at[0].startsWith(`collection/`)) {
      return record(itemName, `no Spanish item name`);
    }
    return record(translations.get(english) ?? null, `no matching English`);
  };

  const walk = (node: Tree, at: string[]): Tree => {
    const out: Tree = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = typeof value === `object` && value !== null ? walk(value, [...at, key]) : leaf(key, at, String(value));
    }
    return out;
  };

  return { tree: walk(subtree, []), translated, gaps, drifted };
}

// ── The stage ──────────────────────────────────────────────────────────────────────────────────

const resourcesDir = resolve(process.argv[2] ?? join(import.meta.dirname, `../src/main/resources/direct-file`));
const localesDir = join(resourcesDir, `locales`);

const flowConfig = JSON.parse(readFileSync(join(import.meta.dirname, `flow-config.json`), `utf8`)) as FlowConfig;
const english = JSON.parse(readFileSync(join(import.meta.dirname, `content.json`), `utf8`)) as ResolvedContent;
const { pages } = JSON.parse(readFileSync(join(import.meta.dirname, `pages.json`), `utf8`)) as { pages: EmittedPage[] };

const generatedPath = join(localesDir, `flow_en.yaml`);
const generated = load(readFileSync(generatedPath, `utf8`)) as Tree | null;
if (generated === null || typeof generated !== `object`) {
  throw new Error(
    `${generatedPath} holds no keys. It is written by form-builder while it parses the flow, so run ` +
      `\`make site\` before \`make transpile-es\`.`
  );
}

// Stage 4 again, in Spanish. Same screens, same component mapper, same modal ids.
const spanish = resolveContent(es, `es`, flowConfig.screens, flowConfig.pages);

const screensByRoute = new Map(flowConfig.screens.map((screen) => [screen.screenRoute, screen]));
const pagesByRoute = new Map(pages.map((page) => [page.route, page]));

const counts: Counts = { unpairedLeaves: 0, ambiguousText: 0, screensMissingContent: 0 };
const out: Tree = {};
const gaps: { page: string; key: string; gap: Gap; english: string }[] = [];
let translated = 0;
let total = 0;
let drifted = 0;

for (const [route, subtree] of Object.entries(generated)) {
  if (typeof subtree !== `object` || subtree === null) {
    throw new Error(`${generatedPath}: top-level key ${route} is not a page subtree`);
  }
  const page = pagesByRoute.get(route);
  if (page === undefined) {
    // Every top-level key in flow_en.yaml is a `<page route>` and every page this transpiler wrote is
    // in pages.json, so the two disagreeing means they are from different builds. Fails here rather
    // than skipping the page, which would write a file whose key set does not match and leave
    // `verify-translation.ts` reporting a hundred missing keys instead of the one cause.
    throw new Error(
      `${generatedPath} has a page ${route} that codemod/pages.json does not, so the flow and the ` +
        `locale were built from different runs. Run \`make transpile && make site\` first.`
    );
  }

  const translations = new PageTranslations(counts);
  for (const screenRoute of page.screens) {
    pairScreen(screenRoute, null, english, spanish, screensByRoute, translations, counts);
  }
  for (const screenRoute of page.collection?.screens ?? []) {
    pairScreen(screenRoute, page.collection!.path, english, spanish, screensByRoute, translations, counts);
  }

  const result = translatePage(subtree, page, translations, spanish);
  out[route] = result.tree;
  translated += result.translated;
  total += result.translated + result.gaps.length;
  drifted += result.drifted;
  for (const gap of result.gaps) gaps.push({ page: route, ...gap });
}

// splitLines is off — a value stays on its key's line, so the TODO sentinel can be lifted into a
// comment above it the way `syncTranslationLocales` does. `Locale` reads this file back with a YAML
// 1.2 parser, and js-yaml's default schema quotes anything a 1.1 reader would have retyped, so
// everything it emits plain is plain in both.
const yamlBody = dump(out, { lineWidth: -1, noRefs: true, sortKeys: false });
const withComments = yamlBody
  .split(`\n`)
  .flatMap((line) => {
    if (!line.includes(TODO_SENTINEL)) return [line];
    const indent = line.slice(0, line.length - line.trimStart().length);
    return [`${indent}${TODO_COMMENT}`, line.replace(TODO_SENTINEL, ``)];
  })
  .join(`\n`);

const header =
  `# DO NOT EDIT, THIS IS A GENERATED FILE\n` +
  `#\n` +
  `# Seeded by \`make transpile-es\` from IRS Direct File's own es.yaml. The keys are flow_en.yaml's,\n` +
  `# which form-builder content-addresses on the English text, so they are joined to Direct File's\n` +
  `# keys by that text rather than looked up. See codemod/translate.ts.\n` +
  `#\n` +
  `# Entries marked "${TODO_COMMENT}" carry the English words: nothing upstream matched them. A\n` +
  `# later edit to the flow re-keys its entry here the same way it would a hand-written translation,\n` +
  `# and form-builder's syncTranslationLocales is what carries one forward from there.\n` +
  `#\n` +
  `# Markup inside a value is load-bearing: <fg-show> prints a fact, and <modal-link for="…"> has to\n` +
  `# keep pointing at the same modal id.\n`;
writeFileSync(join(localesDir, `flow_es.yaml`), header + withComments.replace(/\n+$/, ``) + `\n`);

// The readable half, beside component-coverage.md and written by the same rule: a number nobody sees
// is not a decision.
const byGap = new Map<Gap, number>();
for (const gap of gaps) byGap.set(gap.gap, (byGap.get(gap.gap) ?? 0) + 1);
const byModule = new Map<string, number>();
for (const gap of gaps) {
  const module = pagesByRoute.get(gap.page)?.module ?? gap.page;
  byModule.set(module, (byModule.get(module) ?? 0) + 1);
}

const report =
  `# Spanish coverage\n\n` +
  `GENERATED by codemod/translate.ts. Regenerate with \`make site && make transpile-es\`.\n\n` +
  `\`locales/flow_es.yaml\` is seeded from IRS Direct File's own \`es.yaml\`, joined to form-builder's\n` +
  `content-addressed keys by the English text each one holds. This is what that join reached.\n\n` +
  `| | |\n|---|---|\n` +
  `| pages | ${Object.keys(out).length} |\n` +
  `| translated values | ${translated} of ${total} |\n` +
  `| untranslated | ${total - translated} |\n\n` +
  `## What did not translate\n\n` +
  (gaps.length === 0
    ? `Nothing. Every key in \`flow_en.yaml\` took a translation.\n`
    : `| Reason | Keys |\n|---|---|\n` +
      [...byGap]
        .sort((a, b) => b[1] - a[1])
        .map(([gap, count]) => `| ${gap} | ${count} |\n`)
        .join(``) +
      `\n### By flow module\n\n| Module | Keys |\n|---|---|\n` +
      [...byModule]
        .sort((a, b) => b[1] - a[1])
        .map(([module, count]) => `| ${module} | ${count} |\n`)
        .join(``) +
      `\n### The first twenty, in flow order\n\n` +
      gaps
        .slice(0, 20)
        .map((gap) => `- \`${gap.page}.${gap.key}\` (${gap.gap}) — ${JSON.stringify(gap.english.slice(0, 90))}\n`)
        .join(``)) +
  `\n## The join itself\n\n| | |\n|---|---|\n` +
  `| leaves paired in one language only | ${counts.unpairedLeaves} |\n` +
  `| screens with content in one language only | ${counts.screensMissingContent} |\n\n` +
  `Both should be 0. The first is the join's own failure mode, a screen whose Spanish resolves to a\n` +
  `differently-shaped tree; the second means one language resolved a screen the other did not, which\n` +
  `upstream's own locale parity should make impossible. A page in \`flow_en.yaml\` that \`pages.json\`\n` +
  `does not have is not counted here at all — it means the two were built from different runs, and it\n` +
  `fails by name rather than writing a file that is missing a page.\n\n` +
  `## Two things that look like defects and are not\n\n` +
  `**${counts.ambiguousText} values are one English sentence with two translations.** Direct File writes\n` +
  `the same sentence under two keys — a screen and a modal, or two phrasings of the same aside — and\n` +
  `translates each in its own words: "¿Qué es un PIN para la Protección de la Identidad (IP PIN)?" and\n` +
  `"¿Qué es un IP PIN?" for one English question. There is one key here to put either under, because\n` +
  `form-builder content-addresses on the English and has already collapsed the two, so the first\n` +
  `occurrence on the page wins. Not a choice this stage makes that the library does not.\n\n` +
  `**${drifted} values interpolate different facts in the two languages.** Upstream writes "hasta el 15\n` +
  `de abril de {{/nextTaxYear}}" where its English says "for {{/lastTaxYear}}", and drops a name where\n` +
  `Spanish repeats the noun instead. \`verify-translation.ts\` is what makes that safe to accept: every\n` +
  `path either language names is checked against the dictionary, and every modal against the dialogs\n` +
  `its own page carries.\n`;
writeFileSync(join(import.meta.dirname, `translation-coverage.md`), report);

console.log(`wrote ${join(localesDir, `flow_es.yaml`)}`);
console.log(`  pages                ${Object.keys(out).length}`);
console.log(`  translated           ${translated} of ${total}`);
console.log(`  untranslated         ${total - translated}`);
for (const [gap, count] of byGap) console.log(`    ${gap.padEnd(20)} ${count}`);
console.log(`  unpaired leaves      ${counts.unpairedLeaves}`);
console.log(`  ambiguous text       ${counts.ambiguousText}`);
console.log(`  interpolation drift  ${drifted}`);
console.log(`  screens missing      ${counts.screensMissingContent}`);
