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


export function xmlAttr(value: string): string {
  return value.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`).replace(/"/g, `&quot;`);
}

export function xmlText(value: string): string {
  return value.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`);
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
}

function bump(context: RenderContext, name: string) {
  context.counts[name] = (context.counts[name] ?? 0) + 1;
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

export function renderBlocks(blocks: Block[], indent: string, context: RenderContext): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const gate = context.gate(block.cond ?? []);
    if (gate === false) {
      bump(context, `blocksDroppedByCondition`);
      continue;
    }
    const xml = renderBlock(block, gate, indent, context);
    if (xml !== null) out.push(xml);
  }
  return out;
}

function renderBlock(block: Block, gate: string | null, indent: string, context: RenderContext): string | null {
  switch (block.k) {
    case `h`: {
      if (isEmpty(block.t)) return null;
      const tag = `h${block.level}`;
      return `${indent}<${tag}${conditionAttrs(gate)}>${renderInline(block.t)}</${tag}>`;
    }

    case `p`: {
      if (isEmpty(block.t)) return null;
      const cls = block.cls ? ` class="${xmlAttr(block.cls)}"` : ``;
      return `${indent}<p${cls}${conditionAttrs(gate)}>${renderInline(block.t)}</p>`;
    }

    case `list`: {
      const items = block.items.filter((item) => !isEmpty(item.t) || (item.blocks?.length ?? 0) > 0);
      if (items.length === 0) return null;
      const tag = block.ordered ? `ol` : `ul`;
      const lines = items.map((item) => {
        // A nested list goes inside its `<li>`, on its own lines. form-builder parses `<li>` as a
        // leaf and re-emits its inner markup verbatim, so this arrives in the page as real nested
        // list markup — at the cost of the nested items sharing the parent item's translation key.
        // See the ListItem doc in content.ts.
        const nested = renderBlocks(item.blocks ?? [], `${indent}    `, context);
        if (nested.length === 0) return `${indent}  <li>${renderInline(item.t)}</li>`;
        return (
          `${indent}  <li>${renderInline(item.t)}\n` +
          `${nested.join(`\n`)}\n` +
          `${indent}  </li>`
        );
      });
      return `${indent}<${tag}${conditionAttrs(gate)}>\n${lines.join(`\n`)}\n${indent}</${tag}>`;
    }

    case `table`: {
      const rows = block.rows.map((row) => {
        const cells = [`${indent}    <th scope="row">${renderInline(row.th)}</th>`];
        // A row with no second cell spans the table; the grammar has no colspan, so it is a th alone.
        if (!isEmpty(row.td)) cells.push(`${indent}    <td>${renderInline(row.td)}</td>`);
        return `${indent}  <tr>\n${cells.join(`\n`)}\n${indent}  </tr>`;
      });
      const caption = isEmpty(block.caption) ? `` : `${indent}  <caption>${renderInline(block.caption)}</caption>\n`;
      // No condition attribute: <table> takes none in the grammar, and giving it one would be a
      // schema change for a case that does not arise — no SummaryTable carries its own condition.
      if (gate !== null) bump(context, `tableConditionsDropped`);
      return `${indent}<table class="usa-table usa-table--borderless">\n${caption}${rows.join(`\n`)}\n${indent}</table>`;
    }

    case `detail`: {
      const body = renderBlocks(block.body, `${indent}  `, context);
      if (body.length === 0) return null;
      const summary = isEmpty(block.summary) ? `Details` : renderInline(block.summary);
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
      const heading = isEmpty(block.heading) ? `Note` : renderInline(block.heading);
      const body = renderBlocks(block.body, `${indent}  `, context);
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
      return renderSet(block, gate, indent, context);

    case `apply`:
      return `${indent}<fg-apply path="${xmlAttr(block.path)}" source="${xmlAttr(block.source)}"/>`;
  }
}

function renderSet(
  block: Extract<Block, { k: 'set' }>,
  gate: string | null,
  indent: string,
  context: RenderContext
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
  lines.push(`${indent}  <question>${renderInline(block.question)}</question>`);
  if (block.hint && !isEmpty(block.hint)) lines.push(`${indent}  <hint>${renderInline(block.hint)}</hint>`);

  const input = block.input;
  if (input.type === `boolean`) {
    if (input.options === undefined) {
      lines.push(`${indent}  <input type="boolean"/>`);
    } else {
      lines.push(`${indent}  <input type="boolean">`);
      for (const option of input.options) {
        lines.push(`${indent}    <option value="${option.value}">${renderInline(option.label)}</option>`);
      }
      lines.push(`${indent}  </input>`);
    }
  } else if (input.type === `enum` || input.type === `multi-enum`) {
    lines.push(`${indent}  <input type="${input.type}" options-path="${xmlAttr(input.optionsPath)}">`);
    for (const option of input.options) {
      // Inline, not text: FgSet stores an option's inner markup as its translation value and the
      // enum templates render it with th:utext, so a year or a bold box number survives to the page.
      lines.push(`${indent}    <option value="${xmlAttr(option.value)}">${renderInline(option.label)}</option>`);
    }
    lines.push(`${indent}  </input>`);
  } else if (input.type === `collection-item-reference`) {
    // The label is the only thing the flow carries: which collection to list is read out of the fact
    // dictionary by the app's parser, so it is not repeated here and cannot drift from it.
    lines.push(`${indent}  <input type="collection-item-reference" item-label="${xmlAttr(input.itemLabel)}"/>`);
  } else if (input.type === `select`) {
    lines.push(`${indent}  <select options-path="${xmlAttr(input.optionsPath)}">`);
    for (const option of input.options) {
      lines.push(`${indent}    <option value="${xmlAttr(option.value)}">${xmlText(option.label)}</option>`);
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
    const body = renderBlocks(modal.body, `${indent}    `, context);
    const heading = isEmpty(modal.heading) ? `More information` : renderInline(modal.heading);
    return (
      `${indent}<modal-dialog id="${xmlAttr(modal.id)}">\n` +
      `${indent}  <modal-heading>${heading}</modal-heading>\n` +
      `${indent}  <modal-content>\n${body.length > 0 ? `${body.join(`\n`)}\n` : `${indent}    <p></p>\n`}${indent}  </modal-content>\n` +
      `${indent}</modal-dialog>`
    );
  });
}
