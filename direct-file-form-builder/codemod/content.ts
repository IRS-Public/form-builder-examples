/**
 * Stage 4 of the transpiler: Direct File's screen content, as a serialisable tree.
 *
 * Stage 2 left every screen rendering its own route as an `<h2>` and its component list as a `<p>`.
 * This turns those 51 component types into the words a taxpayer reads — and, for the fact controls,
 * into the `<fg-set>` that asks the question.
 *
 * ## Why this runs beside stage 1 rather than beside the emitter
 *
 * Content resolution needs three things that live in the Direct File checkout: `en.yaml` (1.4 MB of
 * authored text), the namespacing rules its components apply to a key, and the grammar that turns a
 * YAML body tree into elements. So this module runs under the same `vite-node --root <df-client-app>`
 * as `extract.ts` and imports them:
 *
 *   - `CommonTranslation.getNamespacedKey` — which of `info.`/`headings.`/`fields.`/`modals.` a
 *     path-style key sits under.
 *   - `generateContent` — the `- p:` / `- ul: - li:` grammar, from `packages/df-common`. It builds
 *     React elements, and this walks them: the tags are the structure and each leaf carries the
 *     exact subkey (`…body.1.ul.0.li`) that its text is under. That is the whole reason to import it
 *     rather than write the traversal again — those subkeys are a contract with the YAML, and the
 *     repo's own locale-parity tests are what keep them true.
 *
 * The output is plain JSON, so `emit.ts` still runs under bare `node` and stays reviewable as a diff.
 *
 * ## What this does not import
 *
 * `flowLocaleHelpers.ts`'s `getExpected*Keys` compute the *set of keys* a component needs, which is
 * what a parity test wants. This needs the values, in document order, with the modal and link
 * structure intact — a different question about the same data. Where the two overlap, the key shapes
 * here are the ones those functions state (`${key}.helpText.modals`, `fields.${path}`,
 * `${key}.internalLink`, `${base}.sections.${itemKey}`), and any disagreement is a bug here.
 */
import en from '/src/locales/en.yaml';
// Root-relative, and not the bare `df-i18n` / `@irs/df-common` an app file would write. Vite's root
// is the Direct File client, so `/x` is a path under it and `/../node_modules/x` reaches the
// workspace packages beside it — which is where those two are symlinked. A bare specifier resolves
// from the *importing* file's directory, and this file is in another repository, so it would not
// find them. The deep path into df-common is deliberate too: its package entry point pulls in SCSS
// modules, which vite-node cannot load outside a browser build.
import { CommonTranslation } from '/../node_modules/df-i18n/src/index.js';
import { generateContent } from '/../node_modules/@irs/df-common/src/components/CommonContentDisplay/contentGenerator.js';
// `slug` and `plainText` live in render.ts, which imports nothing from the Direct File checkout. That
// is what lets `emit.ts` — plain `node`, no Vite — use them without pulling this module's `en.yaml`
// import in behind them.
import { modalId, plainText } from './render.ts';

/**
 * Markup this port drops on purpose, and why.
 *
 * The distinction the coverage report rests on. A construct *not* listed here that the walker meets
 * is a gap in the IR — the words survive, the structure does not, and the count is the argument for
 * adding a node. A construct listed here is a decision, and the reason is the whole of it. Nested
 * lists used to be in the first group and are now expressed (see `ListItem`); everything left is in
 * the second.
 */
export const DROPPED_WITH_REASON: Record<string, string> = {
  '<InternalLink>':
    `every remaining one points at a \`/data-view/…\` route. This port has no DataView — the topic ` +
    `page is its review surface — so there is nowhere to link to. The words stay, the link goes.`,
  '<customerSupportLink>':
    `upstream binds no component and no url to this tag either, so it renders as plain text in ` +
    `Direct File too. Not a difference from upstream.`,
  '<InlinePDFButton>': `out of scope: PDF. The sentence survives; the download button does not.`,
  '<span>':
    `carries no semantics — "the Form <span>W-2</span>" reads the same without it. On a data-import ` +
    `screen, which is out of scope in any case.`,
  'markup in a collection item label':
    `the label is a template the browser evaluates once per collection item, so it reaches the page ` +
    `as an attribute rather than as markup. One of the nine wraps itself in a <p>.`,
};

// ── The intermediate representation ────────────────────────────────────────────────────────────
//
// Deliberately smaller than HTML: every shape here is one the app's FlowConfig.rng already accepts,
// so the emitter is a printer rather than a second translation. Anything Direct File expresses that
// this cannot hold is a gap, and is counted rather than approximated.

/** Text and what may appear inside a line of it. */
export type Inline =
  | { k: 'text'; v: string }
  | { k: 'strong'; c: Inline[] }
  | { k: 'em'; c: Inline[] }
  | { k: 'br' }
  /** `<fg-show path>` — the current value of a fact, printed inline. */
  | { k: 'fact'; path: string }
  | { k: 'link'; href: string; c: Inline[] }
  /** `<modal-link for>` — opens one of the page's hoisted `<modal-dialog>`s. */
  | { k: 'modal'; id: string; c: Inline[] };

/**
 * One `<li>`: its own line, and whatever blocks were nested under it.
 *
 * `blocks` is in practice always a nested list. Direct File authors them inside an `<li>`'s own
 * string — 44 of them — and before this existed the inline walker met the `<ul>`, kept the words and
 * dropped the structure, so a two-level list arrived as one flat run of sentences.
 *
 * The consequence to know: form-builder treats `<li>` as a *leaf* (`parser/Html.scala`'s
 * `LEAF_NODES`), storing its inner markup as one translation string and re-emitting it verbatim. So
 * a nested list renders as a nested list, and its items share their parent item's translation key
 * rather than getting their own. Making `<li>` a non-leaf is a library change that would re-key
 * every list item in all four applications, which is not this port's to make.
 */
export interface ListItem {
  t: Inline[];
  blocks?: Block[];
}

/**
 * A block, plus the content declaration's own conditions if it had any.
 *
 * `cond` is left raw on purpose. Turning a condition set into a gate fact needs the screen's
 * collection scope, which `emit.ts` holds and this does not — so this records what upstream said and
 * the emitter decides what fact expresses it.
 */
export type Block = BlockBody & { cond?: unknown[] };

type BlockBody =
  | { k: 'h'; level: 2 | 3 | 4; t: Inline[] }
  | { k: 'p'; cls?: string; t: Inline[] }
  | { k: 'list'; ordered: boolean; items: ListItem[] }
  /** `knockout` is set by the emitter, which is what knows the screen is one. */
  | { k: 'alert'; type: 'error' | 'warning' | 'info' | 'success'; heading: Inline[]; body: Block[]; knockout?: true }
  | { k: 'detail'; summary: Inline[]; body: Block[] }
  | { k: 'table'; caption: Inline[]; rows: { th: Inline[]; td: Inline[] }[] }
  | { k: 'set'; path: string; question: Inline[]; hint?: Inline[]; input: InputSpec; optional?: true }
  /** A `<SetFactAction>`, which lives on the screen rather than in its content. Built by the emitter. */
  | { k: 'apply'; path: string; source: string };

export type InputSpec =
  | { type: 'boolean'; options?: { value: 'true' | 'false'; label: Inline[] }[] }
  | { type: 'dollar' | 'text' | 'date' | 'int' | 'tin' | 'ein' | 'pin' | 'ip-pin' | 'phone-number' | 'address' | 'bank-account' }
  /**
   * Which item of another collection this fact points at. `itemLabel` is Direct File's
   * `fields.{path}.item` carried whole — `{{/filers/*\/firstName}} {{/filers/*\/lastName}}` — because
   * the browser evaluates it once per item, and the collection to list is not here at all: the app's
   * `CollectionItemReference` parser reads it off the fact dictionary.
   */
  | { type: 'collection-item-reference'; itemLabel: string }
  /**
   * `label` is inline for `enum` and `multi-enum`, whose templates render it with `th:utext` — so an
   * option may say "in <fg-show path="/taxYear"/>" or bold a box number, the way its question can.
   * `select` keeps a plain string, because HTML's `<option>` holds text and nothing else.
   */
  | { type: 'enum' | 'multi-enum'; optionsPath: string; options: { value: string; label: Inline[] }[] }
  | { type: 'select'; optionsPath: string; options: { value: string; label: string }[] };

export interface ModalDialog {
  id: string;
  heading: Inline[];
  body: Block[];
}

export interface ScreenContent {
  /** The screen's own `Heading`, which is also where a page takes its title. */
  heading: Inline[] | null;
  blocks: Block[];
  /** Hoisted to the page by the emitter, so two screens naming the same modal share one dialog. */
  modals: ModalDialog[];
}

/** Which of `component-coverage.md`'s five groups a component type falls in. */
export type ComponentCategory = 'expressed' | 'rendered-elsewhere' | 'out-of-scope' | 'not-expressible';

export interface ContentReport {
  /**
   * Component type → its category, every disposition it took with a count, and its screen total.
   *
   * `component-coverage.md` is written from this. The dispositions are a list because one type can
   * be handled two ways depending on its props.
   */
  components: Record<
    string,
    { category: ComponentCategory; dispositions: { disposition: string; count: number }[]; screens: number }
  >;
  /** Keys a component named that `en.yaml` does not have. */
  missingKeys: string[];
  /** Inline constructs met that the IR has no shape for, with counts. */
  /** Constructs the IR has no node for. A gap; each entry is an argument for adding one. */
  unhandledInline: Record<string, number>;
  /** Markup dropped on purpose: the count, and the reason it is not a gap. */
  droppedWithReason: Record<string, { count: number; because: string }>;
  /** Either kind, with the content keys it was met under — where to go and look. */
  unhandledExamples: Record<string, string[]>;
  /** Enum/multi-enum option labels whose markup had to be flattened, with counts. */
  flattenedOptionLabels: number;
}

// ── Reading en.yaml ────────────────────────────────────────────────────────────────────────────

/**
 * i18next's own key resolution: split on `.` and walk. Path-style keys hold no dots, so
 * `info./info/x/y.body` splits cleanly into namespace, key and subkey.
 */
function lookup(key: string): unknown {
  let node: unknown = en;
  for (const part of key.split(`.`)) {
    if (node === null || typeof node !== `object`) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** The `t` shape `maybeUrls` expects: a key in, the raw value out. */
const tFn = ((key: string | string[]) => lookup(Array.isArray(key) ? key[0] : key)) as never;

/**
 * The namespace a key actually resolves under.
 *
 * `getNamespacedKey` is the rule Direct File's components apply, and it is tried first. It is not
 * the whole rule, though: `Heading` sends a non-`/info` key to `headings.`, `Subheading` sends its
 * key bare, and `ConditionalList` prefixes nothing. Rather than reproduce each component's private
 * variant, the fallbacks below are tried in turn and the first one that exists wins — which is what
 * `CommonTranslation.getFallbackKey` does for the components that have more than one candidate.
 */
const NAMESPACES = [`headings`, `subheadings`, `info`, `fields`, `iconLists`, `modals`, `dataviews`];

function resolveKey(rawKey: string): string | null {
  const namespaced = CommonTranslation.getNamespacedKey(rawKey);
  if (lookup(namespaced) !== undefined) return namespaced;
  for (const ns of NAMESPACES) {
    if (lookup(`${ns}.${rawKey}`) !== undefined) return `${ns}.${rawKey}`;
  }
  return lookup(rawKey) !== undefined ? rawKey : null;
}

// ── Inline text ────────────────────────────────────────────────────────────────────────────────

/** `{{/factPath}}` — the same pattern `useTranslationContextFromFacts` scans for. */
const FACT_REFERENCE = /\{\{(\/[^, }]+)[^}]*\}\}/g;
/** `$t(some.key)` — i18next's own cross-reference. */
const T_REFERENCE = /\$t\(([^)]+)\)/g;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ` `,
  '&amp;': `&`,
  '&lt;': `<`,
  '&gt;': `>`,
  '&quot;': `"`,
  '&apos;': `'`,
};

export class Resolver {
  private readonly modals = new Map<string, ModalDialog>();
  readonly missingKeys = new Set<string>();
  readonly unhandledInline = new Map<string, number>();
  readonly droppedWithReason = new Map<string, number>();
  /** construct → the keys it was met under. Counts say how big a gap is; these say where it is. */
  readonly unhandledExamples = new Map<string, Set<string>>();
  flattenedOptionLabels = 0;

  /** The key currently being resolved, so a note can say where the construct was met. */
  private currentKey: string | null = null;

  /** Run `body` with `key` recorded as the origin of anything it notes. Restores on the way out, so
   *  a nested resolution (a modal reached from a body tree) reports itself and then hands back. */
  private under<T>(key: string, body: () => T): T {
    const previous = this.currentKey;
    this.currentKey = key;
    try {
      return body();
    } finally {
      this.currentKey = previous;
    }
  }

  private note (what: string) {
    const counter = Object.hasOwn(DROPPED_WITH_REASON, what) ? this.droppedWithReason : this.unhandledInline;
    counter.set(what, (counter.get(what) ?? 0) + 1);
    const seen = this.unhandledExamples.get(what) ?? new Set<string>();
    if (this.currentKey !== null) seen.add(this.currentKey);
    this.unhandledExamples.set(what, seen);
  }

  /** The same counter, for a caller outside the inline walk that had to drop markup too. */
  noteUnhandled(what: string) {
    this.note(what);
  }

  /** Modals hoisted while resolving the current screen, then cleared by `takeModals`. */
  takeModals(): ModalDialog[] {
    const all = [...this.modals.values()];
    this.modals.clear();
    return all;
  }

  /** Direct File's namespace rule for a path-style key, with this module's fallbacks. */
  namespaced(rawKey: string): string {
    return resolveKey(rawKey) ?? CommonTranslation.getNamespacedKey(rawKey);
  }

  /** A raw value out of `en.yaml`, for a caller that needs to know its shape. */
  lookupValue(key: string): unknown {
    return lookup(key);
  }

  /** One authored string with no url or modal map behind it — a field label, an option name. */
  inlineText(value: string): Inline[] {
    return this.inline(value, {});
  }

  private text(value: string): string {
    let out = value;
    for (const [entity, char] of Object.entries(ENTITIES)) out = out.split(entity).join(char);
    return out;
  }

  /**
   * One authored string, as inline nodes.
   *
   * The tags are i18next `Trans` components rather than HTML: `Translation` passes `strong`, `italic`,
   * `ul`, `li`, `ol` and `br` plus one component per entry in the sibling `urls:` map, and `DFModal`
   * adds one per `LinkModalN`/`sharedModalX` it found. So a tag is a link when `urls` names it, a
   * modal when the modal map does, and formatting otherwise.
   */
  inline(raw: string, urls: Record<string, string>, modalIds: Record<string, string> = {}): Inline[] {
    const source = this.expandReferences(raw);
    const out: Inline[] = [];
    let cursor = 0;

    const pushText = (value: string) => {
      if (value.length > 0) out.push({ k: `text`, v: this.text(value) });
    };

    while (cursor < source.length) {
      const open = source.indexOf(`<`, cursor);
      if (open === -1) break;
      const close = source.indexOf(`>`, open);
      if (close === -1) break;

      const tag = source.slice(open + 1, close);
      // A self-closing or void tag has no body to find; `<br/>` and `<br>` are the only ones authored.
      if (/^br\s*\/?$/.test(tag)) {
        pushText(source.slice(cursor, open));
        out.push({ k: `br` });
        cursor = close + 1;
        continue;
      }
      // Not a tag we opened — a stray `<` in prose, or a closing tag we are not inside.
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(tag)) {
        pushText(source.slice(cursor, close + 1));
        cursor = close + 1;
        continue;
      }

      const end = source.indexOf(`</${tag}>`, close);
      if (end === -1) {
        pushText(source.slice(cursor, close + 1));
        cursor = close + 1;
        continue;
      }

      pushText(source.slice(cursor, open));
      const body = source.slice(close + 1, end);
      const children = this.inline(body, urls, modalIds);

      if (Object.hasOwn(urls, tag)) out.push({ k: `link`, href: urls[tag], c: children });
      else if (Object.hasOwn(modalIds, tag)) out.push({ k: `modal`, id: modalIds[tag], c: children });
      else if (tag === `strong` || tag === `b`) out.push({ k: `strong`, c: children });
      else if (tag === `italic` || tag === `i` || tag === `em`) out.push({ k: `em`, c: children });
      else if (tag === `p` || tag === `ul` || tag === `ol` || tag === `li`) {
        // Block markup somewhere a block cannot go — inside an `<li>`, a heading, a field label.
        // `blocksFromString` handles it wherever a block *can* go; here the words survive and the
        // structure does not.
        this.note(`block <${tag}> inside inline text`);
        out.push(...children);
      } else {
        // Named but unresolved: a component the caller did not pass, or a link whose url map this
        // key does not carry. The words survive; the link does not, and the count says so.
        this.note(`<${tag}>`);
        out.push(...children);
      }
      cursor = end + tag.length + 3;
    }
    pushText(source.slice(cursor));

    return this.withFactReferences(out);
  }

  /** `$t(key)` is resolved before parsing, so a referenced string's own markup is parsed in place. */
  private expandReferences(raw: string, depth = 0): string {
    if (depth > 4 || !raw.includes(`$t(`)) return raw;
    return this.expandReferences(
      raw.replace(T_REFERENCE, (whole, key: string) => {
        const value = lookup(key.trim());
        if (typeof value === `string`) return value;
        this.missingKeys.add(key.trim());
        return whole;
      }),
      depth + 1
    );
  }

  /** Split every text node on `{{/factPath}}`, which becomes an `<fg-show>`. */
  private withFactReferences(nodes: Inline[]): Inline[] {
    const out: Inline[] = [];
    for (const node of nodes) {
      if (node.k !== `text`) {
        out.push(node);
        continue;
      }
      let last = 0;
      for (const match of node.v.matchAll(FACT_REFERENCE)) {
        if (match.index > last) out.push({ k: `text`, v: node.v.slice(last, match.index) });
        out.push({ k: `fact`, path: match[1] });
        last = match.index + match[0].length;
      }
      if (last === 0) {
        out.push(node);
      } else if (last < node.v.length) {
        out.push({ k: `text`, v: node.v.slice(last) });
      }
    }
    // A remaining `{{name}}` is a context value rather than a fact — a count, a maximum. There is no
    // fact to print, so the braces are counted and left as authored rather than silently dropped.
    for (const node of out) {
      if (node.k === `text` && /\{\{/.test(node.v)) this.note(`{{context}}`);
    }
    return out;
  }

  /**
   * The text of a resolved key, as inline nodes. `[]` when the key is missing, recorded as such.
   *
   * `inherited` carries the url map of the object the key sits under. A body tree's links are
   * declared once, as a `urls:` sibling of `body:`, and every leaf inside it names them — so a leaf
   * resolved on its own would find no links at all. `CommonContentDisplay` passes the same map down
   * as `components`, for the same reason.
   */
  inlineForKey(key: string, modalIds: Record<string, string> = {}, inherited: Record<string, string> = {}): Inline[] {
    return this.under(key, () => {
      if (this.isModal(key)) return this.modalInline(key);
      const value = this.stringForKey(key);
      if (value === null) return [];
      return this.inline(value, { ...inherited, ...this.urlsFor(key) }, modalIds);
    });
  }

  /** A key's own url map, looking inside `helpText.helpLink` for the shape that keeps it there. */
  private urlsFor(key: string): Record<string, string> {
    const resolved = resolveKey(key) ?? key;
    for (const subKey of [`helpText.helpLink.urls`, `helpText.hint.urls`]) {
      const nested = lookup(`${resolved}.${subKey}`);
      if (nested !== null && typeof nested === `object`) return nested as Record<string, string>;
    }
    return CommonTranslation.maybeUrls(tFn, resolved).urls;
  }

  /**
   * A content key, as blocks — the dispatch `getModalOrTranslationComponent` makes at render time.
   *
   * A key may be a modal launcher, a `body:` tree, or a plain sentence, and which it is is a property
   * of the value rather than of the component that named it. Every display component routes through
   * here so that a key changing shape upstream lands on the right branch rather than as a missing
   * `.body`.
   */
  blocksForContent(rawKey: string): Block[] {
    return this.under(rawKey, () => {
      if (this.isModal(rawKey)) return this.modalBlocks(rawKey);
      const resolved = resolveKey(rawKey);
      if (resolved === null) {
        this.missingKeys.add(rawKey);
        return [];
      }
      if (lookup(`${resolved}.body`) !== undefined) return this.blocksForBody(resolved, `body`);
      const value = this.stringForKey(resolved);
      return value === null ? [] : this.blocksFromString(value, this.urlsFor(resolved));
    });
  }

  /**
   * The string a key resolves to.
   *
   * `getTranslationKey` picks `.body` for a `{body, urls}` object and `.text` for anything else, and
   * that covers the two shapes it was written for. Two more are authored here and answer to neither:
   *
   *   - `{helpText: {helpLink: {text, urls}}}` — a HelpLink, whose text is one level further down.
   *   - `{helpText: {hint: {text}}}` — the hint under a field, same idea.
   *   - `{internalLink: "…"}` — a line whose link is supplied by the component rather than a url map.
   *     `checkIfHasInternalLink` is upstream's test for it.
   *
   * Both are checked before falling through to `getTranslationKey`, so a key of either shape reads
   * as the sentence it is rather than as a missing `.text`.
   */
  private stringForKey(key: string): string | null {
    const resolved = resolveKey(key);
    if (resolved === null) {
      this.missingKeys.add(key);
      return null;
    }
    for (const subKey of [`helpText.helpLink.text`, `helpText.hint.text`, `internalLink`]) {
      const nested = lookup(`${resolved}.${subKey}`);
      if (typeof nested === `string`) return nested;
    }
    const { data } = CommonTranslation.maybeUrls(tFn, resolved);
    const transKey = CommonTranslation.getTranslationKey(resolved, data as never) as string;
    const value = lookup(transKey);
    if (typeof value !== `string`) {
      this.missingKeys.add(transKey);
      return null;
    }
    return value;
  }

  /**
   * A key whose text may carry block markup of its own, as blocks.
   *
   * 124 authored strings hold `<p>`, `<ul>` or `<ol>` inline — an artefact of the YAML being written
   * for i18next's `Trans`, which takes `ul` and `li` as components like any other tag. At block level
   * that structure is real and worth keeping; inside an `<li>` there is nowhere to put it, and those
   * are the ones `inline` counts.
   */
  blocksForKey(key: string, modalIds: Record<string, string> = {}, inherited: Record<string, string> = {}): Block[] {
    return this.under(key, () => {
      if (this.isModal(key)) return this.modalBlocks(key);
      const value = this.stringForKey(key);
      if (value === null) return [];
      return this.blocksFromString(value, { ...inherited, ...this.urlsFor(key) }, modalIds);
    });
  }

  /**
   * A run of `<li>`s authored with no wrapper around it, wrapped.
   *
   * `- ul: $t(info./info/income/income-supported-list)` is a `<ul>` whose whole body is a reference,
   * and the key it names holds the `<li>`s and nothing else. Expanding the reference therefore hands
   * `blocksFromString` a bare run of list items — a list body with its list missing, which the block
   * splitter had no pattern for and the inline walker then flattened to sentences.
   *
   * Items already inside a `<ul>`/`<ol>` are masked out first, so only a genuinely unwrapped run is
   * wrapped. An `<li>` inside a `<p>` is left where it is: that is markup in a place a list cannot
   * go, and it stays counted rather than being silently promoted to a list of its own.
   */
  private wrapBareListItems(source: string): string {
    const masked = source.replace(/<(ul|ol)>[\s\S]*?<\/\1>/g, (block) => ` `.repeat(block.length));
    const runs = [...masked.matchAll(/<li>[\s\S]*?<\/li>(?:\s*<li>[\s\S]*?<\/li>)*/g)];
    if (runs.length === 0) return source;

    let out = ``;
    let last = 0;
    for (const run of runs) {
      const end = run.index + run[0].length;
      out += `${source.slice(last, run.index)}<ul>${source.slice(run.index, end)}</ul>`;
      last = end;
    }
    return out + source.slice(last);
  }

  /** One authored string, split on the block tags it may carry. */
  blocksFromString(raw: string, urls: Record<string, string>, modalIds: Record<string, string> = {}): Block[] {
    const source = this.wrapBareListItems(this.expandReferences(raw));
    const out: Block[] = [];
    const push = (text: string) => {
      const nodes = this.inline(text, urls, modalIds);
      if (nodes.length > 0) out.push({ k: `p`, t: nodes });
    };

    let last = 0;
    for (const match of source.matchAll(/<(p|ul|ol)>([\s\S]*?)<\/\1>/g)) {
      const before = source.slice(last, match.index).trim();
      if (before.length > 0) push(before);
      if (match[1] === `p`) {
        push(match[2]);
      } else {
        const items = [...match[2].matchAll(/<li>([\s\S]*?)<\/li>/g)]
          .map((li) => this.listItem(li[1], urls, modalIds))
          .filter((item) => item.t.length > 0 || (item.blocks?.length ?? 0) > 0);
        if (items.length > 0) out.push({ k: `list`, ordered: match[1] === `ol`, items });
      }
      last = match.index + match[0].length;
    }
    const tail = source.slice(last).trim();
    if (tail.length > 0) push(tail);
    return out;
  }

  /**
   * One `<li>`'s authored string, as a line plus whatever it nested under itself.
   *
   * Run through the *block* splitter rather than the inline walker, which is the whole fix: a `<ul>`
   * inside an `<li>` is a block in a place a block can go, and treating the li body as inline-only
   * is what used to drop it. The leading run of paragraphs is the item's own line; anything after
   * the first non-paragraph is nested under it.
   */
  private listItem(raw: string, urls: Record<string, string>, modalIds: Record<string, string>): ListItem {
    const blocks = this.blocksFromString(raw, urls, modalIds);
    const firstNonParagraph = blocks.findIndex((block) => block.k !== `p`);
    if (firstNonParagraph === -1) {
      return { t: blocks.flatMap((block) => (block.k === `p` ? block.t : [])) };
    }
    const lead = blocks.slice(0, firstNonParagraph).flatMap((block) => (block.k === `p` ? block.t : []));
    return { t: lead, blocks: blocks.slice(firstNonParagraph) };
  }

  /**
   * A content key as one `<li>` — its line, plus anything it nested under itself.
   *
   * `ConditionalList`'s items are authored as sentences, except where one carries its own `<ul>` of
   * conditions ("…still take the credit if:" and three bullets). Resolving them as inline flattened
   * that sub-list into the sentence; this keeps it as a list under its item.
   */
  listItemForKey(key: string, inherited: Record<string, string> = {}): ListItem {
    if (this.isModal(key)) return { t: this.modalInline(key) };
    return this.under(key, () => {
      const value = this.stringForKey(key);
      if (value === null) return { t: [] };
      return this.listItem(value, { ...inherited, ...this.urlsFor(key) }, {});
    });
  }

  // ── Body trees ───────────────────────────────────────────────────────────────────────────────

  /**
   * A `body:` (or another subkey) as blocks, using Direct File's own traversal.
   *
   * `generateContent` returns React elements whose tags are the structure and whose leaves are
   * `TranslationComponent` elements carrying the resolved subkey. The placeholder component is never
   * called — React does not invoke a function component until it renders — so walking the tree is
   * reading the traversal's answer, not running the app.
   */
  blocksForBody(
    namespacedKey: string,
    subKey: string | null,
    modalIds: Record<string, string> = {},
    // Links the *component* supplies rather than the locale file — `DFAlert`'s and `DFAccordion`'s
    // `internalLink` route, whose text is wrapped in `<InternalLink>` inside the body. Merged under
    // the key's own url map, so an authored url still wins.
    inherited: Record<string, string> = {},
  ): Block[] {
    const tKey = subKey === null ? namespacedKey : `${namespacedKey}.${subKey}`;
    const body = lookup(tKey);
    if (body === undefined) {
      this.missingKeys.add(tKey);
      return [];
    }
    const { urls: own } = CommonTranslation.maybeUrls(tFn, namespacedKey);
    const urls = { ...inherited, ...own };
    if (typeof body === `string`) {
      return this.blocksFromString(body, urls, modalIds);
    }

    const placeholder = (() => null) as never;
    const tree = generateContent(tKey, body as object, null, undefined, placeholder, {}, {});
    return this.blocksFromTree(tree, urls, modalIds);
  }

  private blocksFromTree(node: unknown, urls: Record<string, string>, modalIds: Record<string, string>): Block[] {
    const out: Block[] = [];
    for (const element of flatten(node)) {
      const tag = element.type;
      if (typeof tag !== `string`) {
        // A bare leaf at block level: a string authored without a tag. `generateContent` leaves the
        // first item of an array unwrapped by design; a paragraph is the only block it can be here.
        const key = (element.props as { i18nKey?: string }).i18nKey;
        if (key) out.push(...this.blocksForKey(key, modalIds, urls));
        continue;
      }
      if (tag === `p`) {
        const leafKey = soleLeafKey(element);
        if (leafKey !== null) out.push(...this.blocksForKey(leafKey, modalIds, urls));
        else out.push({ k: `p`, t: this.inlineOfElement(element, urls, modalIds) });
      } else if (tag === `ul` || tag === `ol`) {
        const items = flatten((element.props as { children?: unknown }).children)
          .filter((li) => li.type === `li` || typeof li.type !== `string`)
          .map((li) => this.listItemOfElement(li, urls, modalIds))
          .filter((item) => item.t.length > 0 || (item.blocks?.length ?? 0) > 0);
        if (items.length > 0) out.push({ k: `list`, ordered: tag === `ol`, items });
      } else if (tag === `h2` || tag === `h3` || tag === `h4`) {
        out.push({ k: `h`, level: Number(tag.slice(1)) as 2 | 3 | 4, t: this.inlineOfElement(element, urls, modalIds) });
      } else if (tag === `li`) {
        // A stray `li` outside a list: keep the words rather than lose them.
        out.push({ k: `p`, t: this.inlineOfElement(element, urls, modalIds) });
      } else {
        this.note(`<${tag}> in a body tree`);
      }
    }
    return out;
  }

  /**
   * One generated `<li>`, as a line plus whatever it nested under itself.
   *
   * The block-level twin of `inlineOfElement`. A generated `<li>`'s leaves are content keys, and a
   * key whose string carries a `<ul>` has to be resolved as blocks rather than as inline — resolving
   * it as inline is exactly what dropped 39 nested items. The leading paragraphs are the line; the
   * rest is nested under it, the same split `listItem` makes for an authored string.
   */
  private listItemOfElement(element: ReactLike, urls: Record<string, string>, modalIds: Record<string, string>): ListItem {
    const blocks: Block[] = [];
    const visit = (node: unknown) => {
      for (const child of flatten(node)) {
        if (typeof child.type === `string`) visit((child.props as { children?: unknown }).children);
        else {
          const key = (child.props as { i18nKey?: string }).i18nKey;
          if (key) blocks.push(...this.blocksForKey(key, modalIds, urls));
        }
      }
    };
    visit(element);

    const firstNonParagraph = blocks.findIndex((block) => block.k !== `p`);
    if (firstNonParagraph === -1) {
      // The ordinary item, and the one that has to keep behaving exactly as it did: an `<li>` whose
      // leaves are all sentences is its own line and nothing else.
      return { t: blocks.flatMap((block) => (block.k === `p` ? block.t : [])) };
    }
    return {
      t: blocks.slice(0, firstNonParagraph).flatMap((block) => (block.k === `p` ? block.t : [])),
      blocks: blocks.slice(firstNonParagraph),
    };
  }

  /** The text inside one generated element: its leaves, in order. */
  private inlineOfElement(element: ReactLike, urls: Record<string, string>, modalIds: Record<string, string>): Inline[] {
    const out: Inline[] = [];
    const visit = (node: unknown) => {
      for (const child of flatten(node)) {
        if (typeof child.type === `string`) visit((child.props as { children?: unknown }).children);
        else {
          const key = (child.props as { i18nKey?: string }).i18nKey;
          if (key) out.push(...this.inlineForKey(key, modalIds, urls));
        }
      }
    };
    const key = (element.props as { i18nKey?: string }).i18nKey;
    if (typeof element.type !== `string` && key) return this.inlineForKey(key, modalIds, urls);
    visit((element.props as { children?: unknown }).children);
    return out;
  }

  // ── Modals ───────────────────────────────────────────────────────────────────────────────────

  /**
   * A `DFModal`: launcher text on the page, and one hoisted dialog per modal named inside it.
   *
   * The shape is `DFModal.tsx`'s. `${key}.helpText.modals` is an object whose `text` is the launcher
   * and whose other entries are the dialogs — `LinkModalN` living under this key, `sharedModalX`
   * living once under the top-level `modals:` and shared by every screen that names it. Which is why
   * a shared modal's id is its own name and a LinkModal's is qualified by the key that owns it.
   */
  modalBlocks(rawKey: string): Block[] {
    const base = resolveKey(rawKey);
    if (base === null) {
      this.missingKeys.add(rawKey);
      return [];
    }
    const modals = lookup(`${base}.helpText.modals`);
    if (modals === null || typeof modals !== `object`) {
      this.missingKeys.add(`${base}.helpText.modals`);
      return [];
    }

    // The tags in the launcher text, not the keys of the object: a `sharedModalX` is referenced here
    // and defined once under the top-level `modals:`, so it never appears as a key of this object.
    // `DFModal.tsx`'s extractTags reads the text for the same reason.
    const ids: Record<string, string> = {};
    for (const name of modalTags(modals as Record<string, unknown>)) {
      const shared = name.startsWith(`sharedModal`);
      const contentKey = shared ? `modals.${name}` : `${base}.helpText.modals.${name}`;
      const id = shared ? modalId([name]) : modalId([base, name]);
      ids[name] = id;
      if (!this.modals.has(id)) this.modals.set(id, this.modalDialog(id, contentKey));
    }

    return this.blocksForBody(`${base}.helpText.modals`, `text`, ids);
  }

  /** True when a key's value is a modal launcher rather than a plain string. */
  isModal(rawKey: string): boolean {
    const base = resolveKey(rawKey);
    return base !== null && this.lookupValue(`${base}.helpText.modals`) !== undefined;
  }

  /** The launcher text of a modal, as inline nodes — for a heading that opens one. */
  modalInline(rawKey: string): Inline[] {
    return this.modalBlocks(rawKey).flatMap((block) => (block.k === `p` ? block.t : []));
  }

  private modalDialog(id: string, contentKey: string): ModalDialog {
    const heading = this.inlineForKey(`${contentKey}.header`);
    const data = lookup(contentKey);
    // A modal whose top level has no `body` is a conditional one: its branches are named keys, and
    // upstream shows whichever the screen's ConditionalList items select. The port has no such
    // selector, so every branch is shown, in order — more than a taxpayer would see, never less.
    const branches =
      data !== null && typeof data === `object` && !Object.hasOwn(data as object, `body`)
        ? Object.keys(data as object).filter((key) => key !== `header` && key !== `urls`)
        : null;

    const body = branches
      ? branches.flatMap((branch) => this.blocksForBody(`${contentKey}.${branch}`, `body`))
      : this.blocksForBody(contentKey, `body`);

    return { id, heading, body };
  }
}

// ── React-element walking ──────────────────────────────────────────────────────────────────────

interface ReactLike {
  type: unknown;
  props: unknown;
}

/** Every element in a `generateContent` result, flattening the nested arrays its traversal returns. */
function flatten(node: unknown): ReactLike[] {
  if (node === null || node === undefined || node === false) return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node === `object` && `type` in (node as object)) return [node as ReactLike];
  return [];
}

/**
 * The modal names a launcher text references, in order.
 *
 * `text` may be a string or a body tree, so every string in it is scanned. This is
 * `DFModal.tsx`'s `extractTags`, narrowed to the two prefixes it filters for.
 */
function modalTags(modals: Record<string, unknown>): string[] {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === `string`) {
      for (const match of node.matchAll(/<(LinkModal\d+|sharedModal[A-Za-z0-9]*)>/g)) {
        if (!found.includes(match[1])) found.push(match[1]);
      }
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === `object`) Object.values(node).forEach(visit);
  };
  visit(modals.text);
  return found;
}

/** The one leaf inside a generated element, or null when it wraps more than text. */
function soleLeafKey(element: ReactLike): string | null {
  const children = flatten((element.props as { children?: unknown }).children);
  if (children.length !== 1 || typeof children[0].type === `string`) return null;
  return (children[0].props as { i18nKey?: string }).i18nKey ?? null;
}


