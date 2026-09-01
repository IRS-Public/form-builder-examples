/**
 * Stage 4's driver: every screen's content, resolved out of one locale bundle.
 *
 * Split out of `extract.ts` because it runs twice. Stage 4 runs it over `en.yaml` and writes
 * `content.json`; stage 15 runs it over `es.yaml` and pairs the result with that file leaf by leaf.
 * Both walks are this function, over the same screens and the same component mapper, so the two
 * trees have the same shape and the same modal ids and differ only in the words — which is the whole
 * of what makes the pairing in `translate.ts` a join rather than a guess.
 *
 * Runs under `vite-node --root <df-client-app>`: `content.ts` and `components.ts` import Direct
 * File's own i18n and content-generator packages, and the bundle itself is one of its YAML files.
 */
import { Resolver, type ComponentCategory, type ContentReport, type Inline, type LocaleBundle, type ScreenContent } from './content.ts';
import { DROPPED_WITH_REASON } from './content.ts';
import { ComponentMapper, NOT_EXPRESSIBLE, OUT_OF_SCOPE, RENDERED_ELSEWHERE, type ContentConfig } from './components.ts';
// `tidyTitle` lives with `pageTitle`, which applies the same rule to a heading-derived title.
import { tidyTitle } from './render.ts';

/** What `resolveContent` needs of a screen: its identity and its content declarations. */
export interface ContentScreen {
  screenRoute: string;
  content: { componentName: string; props: unknown }[];
}

/** What it needs of a page: enough to find the sub-subcategory's nav label. */
export interface ContentPage {
  subcategoryRoute: string;
  subSubcategoryRoute: string | null;
}

export interface ResolvedContent {
  screens: Record<string, ScreenContent>;
  subSubcategoryTitles: Record<string, string>;
  report: ContentReport;
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
 * `{{/familyAndHousehold/*\/firstName}}’s basic information`.
 *
 * 25 of Direct File's 155 labels name the person or the year the page is about, and its side nav
 * fills them in per collection item. A Form Builder page title is a static attribute on `<page>`, so
 * there is nothing to fill them in with, and the honest rendering is the label without them: the
 * topic, minus the personalisation. This is a real difference from upstream and is recorded as one
 * in codemod/README.md rather than papered over.
 *
 * The tidying is deliberately small: drop the interpolation and any possessive stuck to it, drop a
 * dangling word or `#` left at either end, collapse the spaces, and capitalise what is left.
 */
export function depersonalize(label: string, language: string): string {
  const tidied = label
    .replace(/\{\{[^}]*\}\}(’s|'s)?/g, ` `)
    .replace(/\s+/g, ` `)
    .replace(/^[\s’'#,-]+|[\s#,-]+$/g, ``);
  const stripped = tidyTitle(tidied, language);
  return stripped.length === 0 ? label : stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * What one item of a collection is called, in words — `person`, `W-2`, `care provider`.
 *
 * `<fg-collection item-name>` needs it for the Add button ("Add another **W-2**") and the item
 * heading, and Direct File already has the string: the hub screen's Add control reads
 * `fields.{collection}.controls.add`, which is that sentence. Stripping the leading verb — and, in
 * Spanish, the article that follows it — leaves the noun, and the library composes its own button
 * text around it.
 *
 * An auto-iterating loop has no such key, because upstream never names those items: it renders no
 * list, no Add button and no Remove control over a derived collection. This port does render a
 * heading over each one — `<fg-collection>` draws a `<details>` per item whether or not it is
 * editable — so the word has to come from somewhere, and `AUTO_ITERATED_ITEM_NAMES` below is that
 * somewhere.
 */
const ADD_CONTROL_PREFIX = /^(?:Add|Agregar|Añadir)\s+(?:el|la|los|las|un|una|unos|unas|al)\s+|^(?:Add|Agregar|Añadir)\s+/;

export function itemNameFor(bundle: LocaleBundle, collectionName: string): string | null {
  const fields = bundle.fields as Record<string, { controls?: { add?: unknown } }> | undefined;
  const add = fields?.[collectionName]?.controls?.add;
  if (typeof add !== `string`) return null;
  const name = add.replace(ADD_CONTROL_PREFIX, ``).trim();
  return name.length > 0 && name !== add ? name : null;
}

/**
 * What one item of each auto-iterated collection is called, in each language this port ships.
 *
 * Eight of the nineteen collections are a `<Filter>` over `/filers` or `/familyAndHousehold`, walked
 * item by item with nothing to add to. Upstream has no word for them and there is none to derive:
 * the base collection's Add control gives "person" for `/familyAndHousehold` but "Save and continue"
 * for `/filers`, and the collection *path* gives "Cdcc qualifying people 1" as a heading, which is
 * what this replaces.
 *
 * So the eight are chosen here, once, and the table is the record of the choice. A collection that
 * needs a name and is not in it keeps the humanized path and is counted in the manifest, so adding a
 * derived loop upstream shows up as a number rather than as a heading nobody reads.
 *
 * The Spanish column is not a translation of the English one: each is the term the screens around
 * that loop already use in that language — `es.yaml` says "persona calificada" and "hijo calificado"
 * where `en.yaml` says "qualifying person" and "qualifying child".
 */
export const AUTO_ITERATED_ITEM_NAMES: Record<string, Record<string, string>> = {
  // Over `/filers`: the taxpayer, and the spouse on a joint return.
  '/filersWithHsa': { en: `person`, es: `persona` },
  '/cdccQualifyingFilers': { en: `person`, es: `persona` },
  '/filersMaybeEligibleForDisability': { en: `person`, es: `persona` },
  '/filersQualifiedForEdcThroughDisability': { en: `person`, es: `persona` },
  // Over `/familyAndHousehold`, narrowed to the people a credit turns on. "Qualifying person" and
  // "qualifying child" are the terms the screens around these loops already use, so the heading
  // reads as the same document rather than as the collection's internal name.
  '/cdccQualifyingPeople': { en: `qualifying person`, es: `persona calificada` },
  '/cdccNonDependentQualifyingPeopleAssignedTins': { en: `qualifying person`, es: `persona calificada` },
  '/deceasedEitcEligibleQcCollection': { en: `qualifying child`, es: `hijo calificado` },
  '/unclaimedEITCQcsWithTINsCollection': { en: `qualifying child`, es: `hijo calificado` },
};

/** The item name for a collection in one language, or null if neither source names it. */
export function collectionItemName(bundle: LocaleBundle, language: string, collectionName: string): string | null {
  return itemNameFor(bundle, collectionName) ?? AUTO_ITERATED_ITEM_NAMES[collectionName]?.[language] ?? null;
}

/**
 * Stage 4, driven per screen: the content of every screen, resolved once.
 *
 * Written beside `flow-config.json` rather than into it. The two answer different questions — one is
 * the flow's shape, the other its words — and a change to Direct File's copy should show up as a
 * diff of the second alone. `emit.ts` reads both.
 */
export function resolveContent(
  bundle: LocaleBundle,
  language: string,
  screens: ContentScreen[],
  pages: ContentPage[]
): ResolvedContent {
  const resolver = new Resolver(bundle);
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
    if (typeof title === `string`) subSubcategoryTitles[route] = depersonalize(title, language);
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
      droppedWithReason: Object.fromEntries(
        [...resolver.droppedWithReason]
          .sort((a, b) => b[1] - a[1])
          .map(([what, count]) => [what, { count, because: DROPPED_WITH_REASON[what] }]),
      ),
      unhandledExamples: Object.fromEntries([...resolver.unhandledExamples].map(([k, v]) => [k, [...v].sort()])),
      flattenedOptionLabels: resolver.flattenedOptionLabels,
    },
  };
}
