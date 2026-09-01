/**
 * Stage 4's printer: the content IR, as Flow XML.
 *
 * `content.ts` resolved Direct File's text into blocks; this writes them out. It is deliberately a
 * printer and not a second translation — every shape it can emit is one the application's
 * `flow/FlowConfig.rng` already accepts, and anything the IR cannot hold was counted upstream rather
 * than approximated here.
 *
 * Runs under plain `node` with `emit.ts`, so nothing in here reads the Direct File checkout.
 */
import { createHash } from 'crypto';
import type { Block, Inline, ModalDialog } from './content.ts';

/** A stable, readable id fragment: `/info/you/why-dob` → `info-you-why-dob`. */
export function slug(key: string): string {
  return key
    .replace(/[^A-Za-z0-9]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
    .toLowerCase();
}

/**
 * The longest a modal id may be, and why there is a limit at all.
 *
 * Every id becomes a mapping key in the generated `flow_en.yaml`, and over 128 characters the YAML
 * printer switches to the explicit-key form (`? key` on its own line, then `: value`) — which the
 * parser that reads the file back rejects, so the build writes a file it cannot load. Four of Direct
 * File's `/info/credits-and-deductions/credits/eitc/both-filers-combat-pay/...` modal keys are that
 * long. 96 leaves headroom for the context the library nests the id under.
 */
const MAX_MODAL_ID = 96;

/**
 * A modal's id: readable where it fits, and truncated with a hash of the whole where it does not.
 *
 * The hash rather than a counter, so an id stays the same when an unrelated modal is added or the
 * page it sits on is renumbered — the generated locale file is keyed by these.
 */
export function modalId(parts: string[]): string {
  const id = [`modal`, ...parts.map(slug)].join(`-`);
  if (id.length <= MAX_MODAL_ID) return id;
  const hash = createHash(`sha256`).update(id).digest(`hex`).slice(0, 8);
  return `${id.slice(0, MAX_MODAL_ID - 9)}-${hash}`;
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
 *
 * Here rather than in `emit.ts` because it changes the *text* of a leaf as well as the attributes:
 * a paragraph saying `<fg-show path="/filers/*\/firstName"/>` is stored with the rewritten path, so
 * stage 15 has to rewrite before it can recognise the English it is translating.
 */
export function rewritePaths(
  blocks: Block[],
  collectionContext: string | null,
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
    if (match[1] === `/filers` && (collectionContext === `/primaryFiler` || collectionContext === `/secondaryFiler`)) {
      return path.replace(WILDCARD, `${collectionContext}/`);
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

/** Inline nodes as plain text — for a page title, an enum option, an alert heading attribute. */
export function plainText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.k) {
        case `text`:
          return node.v;
        case `br`:
          return ` `;
        case `fact`:
          return ``;
        default:
          return plainText(node.c);
      }
    })
    .join(``)
    .replace(/\s+/g, ` `)
    .trim();
}


/** `your-basic-information` → `Your basic information`. */
export function humanize(segment: string): string {
  const words = segment.replace(/-/g, ` `).trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Words that mean nothing once the thing they governed has been removed, per language.
 *
 * Kept apart rather than merged into one list, because a word is only safe to drop in the language it
 * belongs to. "Schedule A" is a whole label in English and `a` is a Spanish preposition; merging the
 * two would silently retitle that page "Schedule". Direct File has no such label today, which is
 * exactly why this is worth deciding now rather than after one appears.
 */
const DANGLING: Record<string, RegExp> = {
  en: /\s+(to|in|for|with|of|and)$/i,
  // 19 of the Spanish sub-subcategory labels put the name last — "Cantidad pagada a {{…}}".
  es: /\s+(de|del|en|para|con|a|y)$/i,
};

/** Punctuation left standing on its own where the interpolation before it used to be — "… in .". */
const STRANDED_PUNCTUATION = /\s+[.,;:?!]+$/;

/**
 * A title with the hole an interpolation left in it closed up.
 *
 * A `<page title>` is a static attribute, so a heading or a nav label that named a fact loses it, and
 * what is left can end mid-phrase: "…considered married for tax purposes in ." and "{{/lastTaxYear}}
 * expenses paid for in {{/taxYear}}" → "expenses paid for in". Dropping the stranded punctuation and
 * then the words holding nothing gives "…considered married for tax purposes" and "Expenses paid".
 *
 * Repeated rather than applied once, because removing one interpolation can strand two words. A
 * sentence that ends in a full stop attached to its last word is untouched: the punctuation has to be
 * standing alone to be a hole.
 */
export function tidyTitle(text: string, language: string): string {
  const dangling = DANGLING[language] ?? DANGLING.en;
  let out = text.replace(/\s+/g, ` `).trim().replace(STRANDED_PUNCTUATION, ``);
  for (let previous = ``; out !== previous; ) {
    previous = out;
    out = out.replace(dangling, ``).trim();
  }
  return out;
}

/**
 * A page's title, in the order it is worth having.
 *
 * Direct File's own sub-subcategory label first — "Your basic information", the words its side nav
 * uses — because a page is one sub-subcategory's worth of screens and that label is what names it.
 * Then the first screen's heading, which is the sentence Direct File shows on arrival and the only
 * name a page with no sub-subcategory has. Then the route segment, humanized.
 *
 * Here rather than in `emit.ts` because stage 15 has to produce the Spanish title by the same rule,
 * out of the Spanish label and the Spanish heading. Two copies of a three-way fallback would agree
 * until one of them was edited.
 *
 * A heading is tidied the same way a label is, and for the same reason: see `tidyTitle`. It falls
 * back to the untidied sentence rather than to nothing, in the case where a title was an
 * interpolation and little else.
 */
export function pageTitle(
  label: string | undefined,
  firstHeading: Inline[] | null,
  route: string,
  language: string
): string {
  if (label !== undefined) return label;
  if (firstHeading !== null) {
    const sentence = plainText(firstHeading);
    return tidyTitle(sentence, language) || sentence;
  }
  return humanize(route.split(`/`).pop() ?? route);
}

export function xmlAttr(value: string): string {
  return value.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`).replace(/"/g, `&quot;`);
}

export function xmlText(value: string): string {
  return value.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`);
}

/**
 * One value form-builder will store in `flow_en.yaml`, noticed as the printer prints it.
 *
 * Stage 15 pairs an English tree with its Spanish twin, and the only trustworthy account of what a
 * leaf's text *is* comes from the code that writes it: `<li>` carries its nested list inside its own
 * translation value, an empty `<fg-alert>` heading becomes the literal "Note", a `<select>` option
 * is flattened where an enum option is not. Recording from the printer means those stay one
 * decision rather than two that have to agree. See `translate.ts`.
 */
export interface RecordedLeaf {
  /**
   * Where this leaf sits in the block tree — `/2#1/0.q`, not a document position.
   *
   * A structural address rather than an index into the run, so the English and Spanish walks are
   * joined on the shape they share. A subtree that resolves to a different shape in one language
   * then fails to pair and is counted, instead of shifting every leaf after it by one.
   */
  path: string;
  /** `p`, `h2`, `li`, `question`, `option`, `heading`, … — for the report, not for the join. */
  kind: string;
  /** The exact inner markup form-builder stores under this leaf's key. */
  text: string;
}

/** What the printer needs from the emitter: how a block's own conditions become an attribute. */
export interface RenderContext {
  /**
   * The gate fact a content declaration's conditions resolve to.
   *
   * `null` — always shown, so no attribute. `false` — never shown in this port, so the block is not
   * emitted at all. A path — the fact to hang `condition`/`if-true` on.
   */
  gate: (conditions: unknown[]) => string | null | false;
  /** The gate an `<fg-alert>` falls back to, since an alert with no condition renders hidden. */
  alwaysTrue: () => string;
  /** The screen this content is on, for `alert-key` and for error messages. */
  screenRoute: string;
  /** Counters the manifest reports. */
  counts: Record<string, number>;
  /** Stage 15's hook. Absent everywhere else, and the printer's output does not depend on it. */
  record?: (leaf: RecordedLeaf) => void;
}

function bump(context: RenderContext, name: string) {
  context.counts[name] = (context.counts[name] ?? 0) + 1;
}

/** Note a leaf, and hand its text straight back so a call site reads as the assignment it replaces. */
function record(context: RenderContext, path: string, kind: string, text: string): string {
  context.record?.({ path, kind, text });
  return text;
}

export function renderInline(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.k) {
        case `text`:
          return xmlText(node.v);
        case `br`:
          return `<br/>`;
        case `strong`:
          return `<strong>${renderInline(node.c)}</strong>`;
        // The flow's inline grammar has no <em>; <strong> is the emphasis it carries, and the two
        // are not distinguished anywhere in Direct File's own styling.
        case `em`:
          return `<strong>${renderInline(node.c)}</strong>`;
        case `fact`:
          return `<fg-show path="${xmlAttr(node.path)}"/>`;
        case `link`:
          return `<a href="${xmlAttr(node.href)}" target="_blank">${renderInline(node.c)}</a>`;
        case `modal`:
          return `<modal-link for="${xmlAttr(node.id)}">${renderInline(node.c)}</modal-link>`;
      }
    })
    .join(``);
}

/** True when a run of inline nodes would render as nothing at all. */
function isEmpty(nodes: Inline[]): boolean {
  return renderInline(nodes).trim().length === 0;
}

/** `condition="…" operator="isTrue"`, or nothing. */
function conditionAttrs(gate: string | null): string {
  return gate === null ? `` : ` condition="${xmlAttr(gate)}" operator="isTrue"`;
}

/**
 * `path` addresses this run inside the screen, for the leaf recorder. It has no effect on the XML,
 * and every caller that is not stage 15 can leave it at its default.
 */
export function renderBlocks(blocks: Block[], indent: string, context: RenderContext, path = ``): string[] {
  const out: string[] = [];
  blocks.forEach((block, index) => {
    const gate = context.gate(block.cond ?? []);
    if (gate === false) {
      bump(context, `blocksDroppedByCondition`);
      return;
    }
    const xml = renderBlock(block, gate, indent, context, `${path}/${index}`);
    if (xml !== null) out.push(xml);
  });
  return out;
}

function renderBlock(
  block: Block,
  gate: string | null,
  indent: string,
  context: RenderContext,
  path: string
): string | null {
  switch (block.k) {
    case `h`: {
      const tag = `h${block.level}`;
      const text = record(context, path, tag, renderInline(block.t));
      if (isEmpty(block.t)) return null;
      return `${indent}<${tag}${conditionAttrs(gate)}>${text}</${tag}>`;
    }

    case `p`: {
      const text = record(context, path, `p`, renderInline(block.t));
      if (isEmpty(block.t)) return null;
      const cls = block.cls ? ` class="${xmlAttr(block.cls)}"` : ``;
      return `${indent}<p${cls}${conditionAttrs(gate)}>${text}</p>`;
    }

    case `list`: {
      // Every item is walked, and the empty ones are dropped afterwards rather than up front, so a
      // Spanish item that resolves to nothing still occupies its address and the two walks stay
      // joined. `renderBlocks` over an item with no nested blocks is a no-op, so this costs nothing.
      const tag = block.ordered ? `ol` : `ul`;
      const items = block.items.map((item, j) => {
        // A nested list goes inside its `<li>`, on its own lines. form-builder parses `<li>` as a
        // leaf and re-emits its inner markup verbatim, so this arrives in the page as real nested
        // list markup — at the cost of the nested items sharing the parent item's translation key.
        // See the ListItem doc in content.ts.
        const nested = renderBlocks(item.blocks ?? [], `${indent}    `, context, `${path}#${j}`);
        const inner =
          nested.length === 0
            ? renderInline(item.t)
            : `${renderInline(item.t)}\n${nested.join(`\n`)}\n${indent}  `;
        record(context, `${path}#${j}`, `li`, inner);
        return { inner, keep: !isEmpty(item.t) || (item.blocks?.length ?? 0) > 0 };
      });

      const lines = items.filter((item) => item.keep).map((item) => `${indent}  <li>${item.inner}</li>`);
      if (lines.length === 0) return null;
      return `${indent}<${tag}${conditionAttrs(gate)}>\n${lines.join(`\n`)}\n${indent}</${tag}>`;
    }

    case `table`: {
      const caption = isEmpty(block.caption)
        ? ``
        : `${indent}  <caption>${record(context, `${path}.caption`, `caption`, renderInline(block.caption))}</caption>\n`;
      const rows = block.rows.map((row, j) => {
        const th = record(context, `${path}.r${j}.th`, `th`, renderInline(row.th));
        const cells = [`${indent}    <th scope="row">${th}</th>`];
        // A row with no second cell spans the table; the grammar has no colspan, so it is a th alone.
        if (!isEmpty(row.td)) {
          const td = record(context, `${path}.r${j}.td`, `td`, renderInline(row.td));
          cells.push(`${indent}    <td>${td}</td>`);
        }
        return `${indent}  <tr>\n${cells.join(`\n`)}\n${indent}  </tr>`;
      });
      // No condition attribute: <table> takes none in the grammar, and giving it one would be a
      // schema change for a case that does not arise — no SummaryTable carries its own condition.
      if (gate !== null) bump(context, `tableConditionsDropped`);
      return `${indent}<table class="usa-table usa-table--borderless">\n${caption}${rows.join(`\n`)}\n${indent}</table>`;
    }

    case `detail`: {
      const summary = record(
        context,
        `${path}.summary`,
        `summary`,
        isEmpty(block.summary) ? `Details` : renderInline(block.summary)
      );
      const body = renderBlocks(block.body, `${indent}  `, context, path);
      if (body.length === 0) return null;
      return (
        `${indent}<fg-detail${conditionAttrs(gate)}>\n` +
        `${indent}  <summary>${summary}</summary>\n${body.join(`\n`)}\n${indent}</fg-detail>`
      );
    }

    case `alert`: {
      // An `<fg-alert>` with no condition renders hidden — the element is for fact-driven alerts and
      // the template gives it `class="hidden"` when nothing drives it. A Direct File alert is shown
      // whenever its screen is, so an alert with no condition of its own is given one that is always
      // true rather than being silently invisible.
      const condition = gate ?? context.alwaysTrue();
      const heading = record(
        context,
        `${path}.heading`,
        `heading`,
        isEmpty(block.heading) ? `Note` : renderInline(block.heading)
      );
      const body = renderBlocks(block.body, `${indent}  `, context, path);
      const knockout = block.knockout === true ? ` knockout="true"` : ``;
      return (
        `${indent}<fg-alert alert-key="${xmlAttr(context.screenRoute)}" alert-type="${block.type}"${knockout}` +
        `${conditionAttrs(condition)}>\n` +
        `${indent}  <heading>${heading}</heading>\n` +
        (body.length > 0 ? `${body.join(`\n`)}\n` : ``) +
        `${indent}</fg-alert>`
      );
    }

    case `set`:
      return renderSet(block, gate, indent, context, path);

    case `apply`:
      return `${indent}<fg-apply path="${xmlAttr(block.path)}" source="${xmlAttr(block.source)}"/>`;
  }
}

function renderSet(
  block: Extract<Block, { k: 'set' }>,
  gate: string | null,
  indent: string,
  context: RenderContext,
  path: string
): string | null {
  if (isEmpty(block.question)) {
    // `<fg-set>` requires a question, and a control whose label resolved to nothing would ask a
    // blank one. Counted rather than emitted; the fact is still reachable from another screen.
    bump(context, `setsWithoutAQuestion`);
    return null;
  }

  // `if-true` rather than `condition`/`operator`: those are the only two attributes
  // `Condition.getCondition` reads on an `<fg-set>`, and a gate is always Boolean and always total.
  const condition = gate === null ? `` : ` if-true="${xmlAttr(gate)}"`;
  const optional = block.optional ? ` optional="true"` : ``;
  const lines = [`${indent}<fg-set path="${xmlAttr(block.path)}"${condition}${optional}>`];
  const question = record(context, `${path}.question`, `question`, renderInline(block.question));
  lines.push(`${indent}  <question>${question}</question>`);
  if (block.hint && !isEmpty(block.hint)) {
    const hint = record(context, `${path}.hint`, `hint`, renderInline(block.hint));
    lines.push(`${indent}  <hint>${hint}</hint>`);
  }

  /** An option's own address, so its Spanish is joined by value rather than by position. */
  const option = (value: string, name: string) => record(context, `${path}.option.${value}`, `option`, name);

  const input = block.input;
  if (input.type === `boolean`) {
    if (input.options === undefined) {
      lines.push(`${indent}  <input type="boolean"/>`);
    } else {
      lines.push(`${indent}  <input type="boolean">`);
      for (const { value, label } of input.options) {
        lines.push(`${indent}    <option value="${value}">${option(value, renderInline(label))}</option>`);
      }
      lines.push(`${indent}  </input>`);
    }
  } else if (input.type === `enum` || input.type === `multi-enum`) {
    lines.push(`${indent}  <input type="${input.type}" options-path="${xmlAttr(input.optionsPath)}">`);
    for (const { value, label } of input.options) {
      // Inline, not text: FgSet stores an option's inner markup as its translation value and the
      // enum templates render it with th:utext, so a year or a bold box number survives to the page.
      lines.push(`${indent}    <option value="${xmlAttr(value)}">${option(value, renderInline(label))}</option>`);
    }
    lines.push(`${indent}  </input>`);
  } else if (input.type === `collection-item-reference`) {
    // The label is the only thing the flow carries: which collection to list is read out of the fact
    // dictionary by the app's parser, so it is not repeated here and cannot drift from it.
    lines.push(`${indent}  <input type="collection-item-reference" item-label="${xmlAttr(input.itemLabel)}"/>`);
  } else if (input.type === `select`) {
    lines.push(`${indent}  <select options-path="${xmlAttr(input.optionsPath)}">`);
    for (const { value, label } of input.options) {
      lines.push(`${indent}    <option value="${xmlAttr(value)}">${option(value, xmlText(label))}</option>`);
    }
    lines.push(`${indent}  </select>`);
  } else {
    lines.push(`${indent}  <input type="${input.type}"/>`);
  }

  lines.push(`${indent}</fg-set>`);
  return lines.join(`\n`);
}

/** A page's hoisted modals. Two screens naming the same dialog share one, by id. */
export function renderModals(modals: ModalDialog[], indent: string, context: RenderContext): string[] {
  return modals.map((modal) => {
    // The id, not a position: a modal is hoisted to the page from whichever screen named it, and two
    // screens may name the same one, so its address has to be the thing that identifies it.
    const at = `modal:${modal.id}`;
    const body = renderBlocks(modal.body, `${indent}    `, context, at);
    const heading = record(
      context,
      `${at}.heading`,
      `modal-heading`,
      isEmpty(modal.heading) ? `More information` : renderInline(modal.heading)
    );
    return (
      `${indent}<modal-dialog id="${xmlAttr(modal.id)}">\n` +
      `${indent}  <modal-heading>${heading}</modal-heading>\n` +
      `${indent}  <modal-content>\n${body.length > 0 ? `${body.join(`\n`)}\n` : `${indent}    <p></p>\n`}${indent}  </modal-content>\n` +
      `${indent}</modal-dialog>`
    );
  });
}
