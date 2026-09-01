/**
 * Stage 4's component table: one Direct File content declaration in, blocks out.
 *
 * `codemod/content.ts` owns the text — keys, body trees, links, modals. This owns the mapping: which
 * of the 51 component types becomes a heading, a paragraph, an alert, an `<fg-set>`, or nothing.
 *
 * ## The rule for "nothing"
 *
 * Every type is listed. A type that maps to nothing says why, and the manifest reports the
 * disposition beside the count — so a construct is dropped on the record or not at all. Three kinds
 * of nothing appear below, and they are not the same thing:
 *
 *   - **rendered elsewhere** — `SaveAndOrContinueButton` is the Next button `page.html` draws itself;
 *     `CollectionItemManager` is the Add control `<fg-collection>` draws itself.
 *   - **out of scope** — submission, PDF, data import, the state-tax handoff and the MeF alerts are
 *     the four things this port does not do. Named in `OUT_OF_SCOPE` so an unlisted type is an error.
 *   - **not expressible** — a real gap. `FactSelect`'s paired amount lives at a path assembled from
 *     the chosen code, which the Flow XML cannot name. These are the ones worth reading.
 */
import { wrappedFacts } from '/src/fact-dictionary/generated/wrappedFacts.js';
import { getEnumOptions, getEnumOptionsPath } from '/src/locales/flowLocaleHelpers.js';
import type { Block, Inline, InputSpec, Resolver } from './content.ts';
import { plainText, slug } from './render.ts';

export interface ContentConfig {
  componentName: string;
  props: Record<string, unknown>;
}

export interface ScreenContext {
  screenRoute: string;
  /** The screen's `Heading`, so a fact control with no label of its own can borrow it. */
  heading: Inline[];
}

/** Types that are somebody else's job to draw, and whose absence here is not a gap. */
const RENDERED_ELSEWHERE: Record<string, string> = {
  SaveAndOrContinueButton: `page.html draws the Next button`,
  KnockoutButton: `folded into the knockout alert`,
  CollectionItemManager: `<fg-collection> draws the Add and Remove controls`,
  CollectionControl: `<fg-collection> draws the Add and Remove controls`,
};

/** The four things this port does not do, per the plan's scope. */
const OUT_OF_SCOPE: Record<string, string> = {
  SubmitButton: `out of scope: submission`,
  SaveAndOrContinueAndSetFactButton: `out of scope: submission`,
  ExitButton: `out of scope: the Direct File dashboard`,
  DownloadPDFButton: `out of scope: PDF`,
  DataPreview: `out of scope: data import`,
  CollectionDataPreview: `out of scope: data import`,
  ImportAgiContent: `out of scope: data import`,
  StateInfoCard: `out of scope: the state-tax handoff`,
  StateTaxReminderAlertWrapper: `out of scope: the state-tax handoff`,
  StateTaxesButton: `out of scope: the state-tax handoff`,
  MefAlert: `out of scope: MeF rejection codes`,
  TaxReturnAlert: `out of scope: MeF submission validation`,
  SectionReview: `out of scope: the Checklist and DataView. The topic page is the review surface.`,
  CollectionDataViewInternalLink: `out of scope: the DataView`,
  CertifyCheckbox: `out of scope: the e-signature path`,
};

/**
 * Real gaps: expressible in Direct File, not in this flow.
 *
 * Empty, and worth leaving here rather than deleting. `CollectionItemReference` was its one entry —
 * thirteen questions that rendered with no control able to answer them — until the application grew
 * an `<input type="collection-item-reference">` for it. The table is the place a newly-met component
 * goes while it is still a gap, and the emit keeps failing on an unlisted type either way.
 */
const NOT_EXPRESSIBLE: Record<string, string> = {};

/** Fact controls, and the `<input type>` each becomes. */
const INPUT_TYPES: Record<string, InputSpec['type']> = {
  Boolean: `boolean`,
  Dollar: `dollar`,
  Enum: `enum`,
  MultiEnum: `multi-enum`,
  GenericString: `text`,
  LimitingString: `text`,
  DatePicker: `date`,
  Tin: `tin`,
  Ein: `ein`,
  Pin: `pin`,
  IpPin: `ip-pin`,
  PhoneNumber: `phone-number`,
  Address: `address`,
  BankAccount: `bank-account`,
  CollectionItemReference: `collection-item-reference`,
  // The code, as a dropdown. See Main.scala for why the amount beside it is not here.
  FactSelect: `select`,
};

/** The options fact behind a MultiEnum writable, which `getEnumOptionsPath` only answers for Enums. */
function multiEnumOptionsPath(path: string): string {
  const fact = wrappedFacts.find((f) => f.path === path && f.writable?.typeName === `MultiEnum`);
  const optionsPath = fact?.writable?.options?.optionsPath;
  if (!optionsPath) throw new Error(`no options path for MultiEnum ${path}`);
  return optionsPath as string;
}

export class ComponentMapper {
  /**
   * componentName → each disposition it took → how many declarations took it.
   *
   * Every one, not the last one: a type can be handled two ways depending on its props, and
   * `Address` is the reason this is a map rather than a string. Nine of its declarations are marked
   * `displayOnlyOn: 'data-view'` and skipped, and one is a real question — recording only the last
   * would have said the address input is never rendered, which is a claim `component-coverage.md`
   * would then have made in writing.
   */
  readonly dispositions = new Map<string, Map<string, number>>();
  readonly screensPerComponent = new Map<string, number>();

  constructor(private readonly r: Resolver) {}

  private record(name: string, disposition: string) {
    const counts = this.dispositions.get(name) ?? new Map<string, number>();
    counts.set(disposition, (counts.get(disposition) ?? 0) + 1);
    this.dispositions.set(name, counts);
    this.screensPerComponent.set(name, (this.screensPerComponent.get(name) ?? 0) + 1);
  }

  /** One content declaration, as the blocks it becomes. Empty when it draws nothing. */
  blocks(config: ContentConfig, screen: ScreenContext): Block[] {
    const { componentName: name, props } = config;
    const key = props.i18nKey as string | string[] | undefined;
    const i18nKey = Array.isArray(key) ? key[0] : key;

    // Content marked for the DataView only never appears on an editing screen, and the topic page is
    // an editing screen.
    if (props.displayOnlyOn === `data-view`) {
      this.record(name, `skipped where displayOnlyOn is data-view`);
      return [];
    }

    const conditions = ownConditions(props);
    const withCondition = (blocks: Block[]): Block[] =>
      conditions.length === 0 ? blocks : blocks.map((block) => ({ ...block, cond: conditions }));

    if (Object.hasOwn(RENDERED_ELSEWHERE, name)) {
      this.record(name, RENDERED_ELSEWHERE[name]);
      return [];
    }
    if (Object.hasOwn(OUT_OF_SCOPE, name)) {
      this.record(name, OUT_OF_SCOPE[name]);
      return [];
    }
    if (Object.hasOwn(NOT_EXPRESSIBLE, name)) {
      this.record(name, NOT_EXPRESSIBLE[name]);
      return [];
    }

    if (Object.hasOwn(INPUT_TYPES, name)) return withCondition(this.factControl(config, screen));

    switch (name) {
      // The screen's own title. Emitted by the caller, which also needs it for the page title, so it
      // draws nothing a second time here.
      case `Heading`:
        this.record(name, `the screen's <h2>, and the page title when the screen opens one`);
        return [];

      case `ContextHeading`:
        this.record(name, `<p class="df-context-heading">`);
        return withCondition([{ k: `p`, cls: `df-context-heading`, t: this.r.inlineForKey(`headings.${i18nKey}`) }]);

      case `Subheading`:
        this.record(name, `<h3>`);
        return withCondition([{ k: `h`, level: 3, t: this.r.inlineForKey(i18nKey!) }]);

      case `Hint`:
        this.record(name, `<p class="usa-hint">`);
        return withCondition([{ k: `p`, cls: `usa-hint`, t: this.r.inlineForKey(`info./info${i18nKey}`) }]);

      case `InfoDisplay`:
      case `IntroContent`:
      case `BigContent`:
      case `HelpLink`:
        this.record(name, `the key's content: a body tree, a sentence, or a modal launcher`);
        return withCondition(this.r.blocksForContent(i18nKey!));

      case `IconList`:
        this.record(name, `<ul>, one <li> per line`);
        return withCondition(this.iconList(i18nKey!));

      case `DFModal`:
        this.record(name, `<modal-link> plus a hoisted <modal-dialog>`);
        return withCondition(this.r.modalBlocks(i18nKey!));

      case `InternalLink`:
        this.record(name, `<p> with a link to the named flow route`);
        return withCondition(this.internalLink(props));

      case `StateInfoAlert`:
        this.record(name, OUT_OF_SCOPE.StateInfoCard);
        return [];

      case `IconDisplay`:
        // Decorative: a checkmark over a knockout, a lock over the signature page. Nothing it carries
        // is information the words do not already have.
        this.record(name, `dropped: decorative`);
        return [];

      case `DFAlert`:
        this.record(name, `<fg-alert>`);
        return withCondition(this.alert(config, screen));

      case `FactAssertion`:
      case `FactResultAssertion`:
        this.record(name, `<p class="df-assertion">`);
        return withCondition([{ k: `p`, cls: `df-assertion`, t: this.r.inlineForKey(i18nKey!) }]);

      case `DFAccordion`:
      case `ConditionalAccordion`:
        this.record(name, `<fg-detail>`);
        return withCondition(this.accordion(config));

      case `ConditionalList`:
        this.record(name, `<ul>, one <li> per item that still has a condition`);
        return withCondition(this.conditionalList(config));

      case `SummaryTable`:
        this.record(name, `<table> of label/value rows`);
        return withCondition(this.summaryTable(config));

      default:
        throw new Error(
          `${screen.screenRoute}: no mapping for content component "${name}". Add it to the table in ` +
            `codemod/components.ts, or to OUT_OF_SCOPE with the reason.`
        );
    }
  }

  // ── Fact controls ────────────────────────────────────────────────────────────────────────────

  private factControl(config: ContentConfig, screen: ScreenContext): Block[] {
    const { componentName: name, props } = config;
    const path = props.path as string;
    const type = INPUT_TYPES[name];

    // A read-only control displays an answer given elsewhere rather than asking for one. `<fg-set>` has
    // no such mode, and `<fg-show>` is exactly this: the label, then the value.
    if (props.readOnly === true) {
      this.record(name, `read-only display: a <p> with <fg-show>`);
      const label = this.fieldLabel(path);
      return [{ k: `p`, t: [...(label.length > 0 ? [{ k: `strong` as const, c: label }, { k: `text` as const, v: ` ` }] : []), { k: `fact`, path }] }];
    }

    // `CollectionItemReference` passes `labelledBy: 'heading'` unconditionally, so its `fields.{path}`
    // entry is not a label upstream ever shows — and for five of the eight paths it is not a label at
    // all, but the path repeated back (`name: /formW2s/*/filer`). Taking the heading is both the
    // faithful reading and the only one that does not put a fact path on screen as a question.
    const label = name === `CollectionItemReference` ? [] : this.fieldLabel(path);
    // Direct File's `labelledBy: 'heading'` is the common case for a screen with one question: the
    // field has no label of its own and the screen's Heading is it. `<fg-set>` needs a question, so
    // it borrows the heading — and the caller drops the duplicate `<h2>` when that is all the
    // screen holds.
    const question = label.length > 0 ? label : screen.heading;

    const input = this.input(name, type, path, props);
    this.record(name, `<fg-set> with <input type="${input.type}">`);

    // Direct File's fact components default `required` to true; `required={false}` is the explicit
    // opt-out authors write for a field like a middle initial or suffix. `<fg-set optional="true">` is
    // the one Flow XML attribute that carries it — dropping it here would make every ported field
    // required, including the ones upstream deliberately made optional.
    const hintKey = props.hintKey as string | undefined;
    return [
      {
        k: `set`,
        path,
        question,
        ...(hintKey ? { hint: this.r.inlineForKey(hintKey) } : {}),
        input,
        ...(props.required === false ? { optional: true as const } : {}),
      },
    ];
  }

  private input(name: string, type: InputSpec['type'], path: string, props: Record<string, unknown>): InputSpec {
    const suffix = props.i18nKeySuffixContext as string | undefined;

    if (type === `boolean`) {
      const labels = this.r.lookupValue(suffix ? `fields.${path}.${suffix}.boolean` : `fields.${path}.boolean`);
      if (labels === null || typeof labels !== `object`) return { type: `boolean` };
      const yes = (labels as Record<string, unknown>).yes;
      const no = (labels as Record<string, unknown>).no;
      if (typeof yes !== `string` || typeof no !== `string`) return { type: `boolean` };
      return {
        type: `boolean`,
        options: [
          { value: `true`, label: this.r.inlineText(yes) },
          { value: `false`, label: this.r.inlineText(no) },
        ],
      };
    }

    if (type === `collection-item-reference`) {
      return { type, itemLabel: this.itemLabel(path) };
    }

    if (type === `enum` || type === `multi-enum` || type === `select`) {
      const optionsPath = type === `multi-enum` ? multiEnumOptionsPath(path) : getEnumOptionsPath(path as never);
      // The order `getExpectedFactControlKeys` states: a suffixed key, then this path's own
      // override, then the options fact's shared copy.
      const keysFor = (value: string) => [
        ...(suffix ? [`fields.${path}.${optionsPath}.${suffix}.${value}`] : []),
        `fields.${path}.${optionsPath}.${value}`,
        `fields.${optionsPath}.${value}`,
      ];
      const values = getEnumOptions(optionsPath as never) as string[];

      if (type === `select`) {
        // An HTML `<option>` holds text. Anything richer is flattened here and counted.
        const options = values.map((value) => ({ value, label: this.optionLabel(keysFor(value), value) }));
        return { type, optionsPath, options };
      }
      const options = values.map((value) => ({ value, label: this.optionLabelInline(keysFor(value), value) }));
      return { type, optionsPath, options };
    }

    return { type };
  }

  /**
   * An enum option's label, as plain text.
   *
   * Flattened rather than kept as inline nodes because `nodes/inputs/enum.html` renders an option
   * name with `th:text`, which escapes — so `<strong>` would show as characters. The boolean input's
   * template uses `th:utext` and keeps its markup, which is why only these are flattened. Every one
   * flattened is counted.
   */
  private optionLabel(candidates: string[], fallback: string): string {
    for (const candidate of candidates) {
      const value = this.r.lookupValue(candidate);
      if (typeof value !== `string`) continue;
      const nodes = this.r.inlineText(value);
      if (nodes.some((node) => node.k !== `text`)) this.r.flattenedOptionLabels += 1;
      return plainText(nodes);
    }
    this.r.missingKeys.add(candidates[0]);
    return fallback;
  }

  /**
   * The same label, kept as inline nodes — for `enum` and `multi-enum`, whose templates emit it with
   * `th:utext`.
   *
   * This is the fix for a defect rather than a nicety. 55 of the 70 labels that used to be flattened
   * held a `{{/fact}}` reference, and `plainText` renders a fact node as the empty string: an option
   * reading "I lived in more than 1 state in {{/taxYear}}" reached the page as "I lived in more than
   * 1 state in", and one whose whole label was "{{/taxYear}}" reached it blank. Only `select` still
   * flattens, because an HTML `<option>` genuinely cannot hold an element.
   */
  private optionLabelInline(candidates: string[], fallback: string): Inline[] {
    for (const candidate of candidates) {
      const value = this.r.lookupValue(candidate);
      if (typeof value !== `string`) continue;
      return this.r.inlineText(value);
    }
    this.r.missingKeys.add(candidates[0]);
    return [{ k: `text`, v: fallback }];
  }

  /** `fields.{path}`, as a string or as that object's `.name`. Empty when the field has no label. */
  /**
   * `fields.{path}.item` — what to call each option — carried into the flow exactly as authored.
   *
   * Deliberately *not* run through the inline IR, unlike every other authored string here. The
   * value is a template rather than a sentence: `{{/filers/*\/firstName}} {{/filers/*\/lastName}}` is
   * evaluated once per collection item, in the browser, with that item's id spliced in. Resolving
   * the fact references at build time would produce one label for a list that has many.
   *
   * Markup is the one thing that cannot survive, because the label ends up as an `<option>`-like
   * string. One of the nine labels wraps itself in a `<p>`; the tags come off and the drop is
   * counted rather than silent.
   */
  private itemLabel(path: string): string {
    const key = `fields.${path}.item`;
    const value = this.r.lookupValue(key);
    if (typeof value !== `string`) {
      this.r.missingKeys.add(key);
      return ``;
    }
    if (/<[^>]+>/.test(value)) this.r.noteUnhandled(`markup in a collection item label`);
    return value.replace(/<[^>]+>/g, ``).replace(/\s+/g, ` `).trim();
  }

  private fieldLabel(path: string): Inline[] {
    const direct = this.r.lookupValue(`fields.${path}`);
    if (typeof direct === `string`) return this.r.inlineText(direct);
    const named = this.r.lookupValue(`fields.${path}.name`);
    return typeof named === `string` ? this.r.inlineText(named) : [];
  }

  // ── The rest ─────────────────────────────────────────────────────────────────────────────────

  private internalLink(props: Record<string, unknown>): Block[] {
    const key = props.i18nKey as string;
    const route = props.route as string | undefined;
    if (route === undefined) return [];
    // Routes are authored with Direct File's `/flow` prefix, which this port drops. `InternalLink` is
    // the tag the authored string wraps the link text in — upstream passes a component under exactly
    // that name — so it is supplied as a url like any other named link.
    // Resolved as blocks rather than inline: every one of these values wraps itself in a `<p>`, and
    // an inline resolution met that as block markup in an inline place and dropped it.
    return this.r.blocksForKey(`${this.r.namespaced(key)}.internalLink`, {}, internalLinkUrl(route));
  }

  /**
   * An `iconList` entry: a flat map of one-line strings, each `<strong>Label</strong><br />{{/fact}}`.
   *
   * Not a body tree — the value has no `body:` and each key is a line rather than a tag — so
   * `blocksForBody` finds nothing there. Upstream renders them as a card of labelled values; a list
   * is the closest shape this flow has.
   */
  private iconList(rawKey: string): Block[] {
    const key = this.r.namespaced(rawKey);
    const value = this.r.lookupValue(key);
    if (value === null || typeof value !== `object`) {
      this.r.missingKeys.add(key);
      return [];
    }
    const items = Object.keys(value as object)
      .filter((line) => line !== `urls`)
      .map((line) => this.r.inlineForKey(`${key}.${line}`))
      .filter((nodes) => nodes.length > 0)
      .map((t) => ({ t }));
    return items.length === 0 ? [] : [{ k: `list`, ordered: false, items }];
  }

  /**
   * A DFAlert, as `<fg-alert>`. The key shapes are `DFAlert.tsx`'s `getKeyValues`:
   *
   *   - a key whose value is a **string** is the message itself, and the alert has no separate
   *     heading — `<fg-alert>` renders its heading as the whole of a bodyless alert, which is the
   *     same thing on the page.
   *   - a key whose value is an **object** carries `alertText.heading` (optional) and an
   *     `alertText` body tree.
   *
   * Nested `childConfigs` are further content declarations, and are mapped like any other.
   */
  private alert(config: ContentConfig, screen: ScreenContext): Block[] {
    const props = config.props;
    const type = (props.type as string) ?? `info`;
    const rawKey = props.i18nKey as string | undefined;
    const key = rawKey ? this.r.namespaced(rawKey) : null;
    const value = key === null ? undefined : this.r.lookupValue(key);

    // `internalLink` names a flow route, and the authored string wraps its link text in an
    // <InternalLink> tag for the component upstream supplies under that name.
    const links = internalLinkUrl(props.internalLink as string | undefined);

    let heading: Inline[];
    let body: Block[];
    if (key === null) {
      heading = screen.heading;
      body = [];
    } else if (typeof value === `string`) {
      heading = this.r.inlineForKey(key, {}, links);
      body = [];
    } else {
      const own = this.r.lookupValue(`${key}.alertText.heading`);
      heading = typeof own === `string` ? this.r.inlineForKey(`${key}.alertText.heading`, {}, links) : [];
      body =
        this.r.lookupValue(`${key}.alertText.body`) === undefined
          ? []
          : this.r.blocksForBody(`${key}.alertText`, `body`, {}, links);
      if (heading.length === 0) {
        // No heading of its own: promote the first paragraph, so the alert still says something in
        // the place `<fg-alert>` renders as its message.
        const first = body.find((block) => block.k === `p`);
        heading = first && first.k === `p` ? first.t : screen.heading;
        body = body.filter((block) => block !== first);
      }
    }

    const children = (props.childConfigs as ContentConfig[] | undefined) ?? [];
    body = [...body, ...children.flatMap((child) => this.blocks(child, screen)).filter((block) => block.k !== `set`)];

    return [
      {
        k: `alert`,
        type: (type === `error` || type === `warning` || type === `success` ? type : `info`) as never,
        heading,
        body,
      },
    ];
  }

  private accordion(config: ContentConfig): Block[] {
    const key = this.r.namespaced(config.props.i18nKey as string);
    const summary = this.r.inlineForKey(`${key}.heading`);
    const items = (config.props.items as { itemKey: string }[] | undefined) ?? [];
    // Same as an alert's: the route is a prop and the link text is inside the body.
    const links = internalLinkUrl(config.props.internalLink as string | undefined);
    const body =
      items.length > 0
        ? items.flatMap((item) => this.r.blocksForBody(`${key}.${item.itemKey}`, null, {}, links))
        : this.r.blocksForBody(key, `body`, {}, links);
    return [{ k: `detail`, summary, body }];
  }

  /**
   * A ConditionalList: a `<ul>` whose items each have their own condition upstream.
   *
   * Every item is emitted. The conditions are per-`<li>` and the flow's `<li>` carries none — the
   * gate machinery is per element, and an `<li>` is not one the RNG lets a condition sit on. So the
   * list shows every branch rather than the branch that applies: more than a taxpayer would see,
   * never less, and counted as the gap it is.
   */
  private conditionalList(config: ContentConfig): Block[] {
    const key = this.r.namespaced(config.props.i18nKey as string);
    const items = (config.props.items as { itemKey: string }[] | undefined) ?? [];
    // An item's `<InternalLink>` points at that item's own `editRoute` — "(edit in the Spouse
    // section)" beside the spouse's date of birth. The route is a prop on the item rather than a url
    // in the locale file, which is why it has to be handed in: without it the tag resolves to
    // nothing, the words survive and the link does not.
    const lines = (config.props.items as ConditionalListItem[] | undefined ?? [])
      .map((item) => this.r.listItemForKey(`${key}.${item.itemKey}`, internalLinkUrl(item.editRoute)))
      .filter((line) => line.t.length > 0 || (line.blocks?.length ?? 0) > 0);
    const prefix = config.props.i18nPrefixKey
      ? this.r.inlineForKey(this.r.namespaced(config.props.i18nPrefixKey as string))
      : [];
    if (lines.length === 0) return prefix.length > 0 ? [{ k: `p`, t: prefix }] : [];
    return [
      ...(prefix.length > 0 ? [{ k: `p` as const, t: prefix }] : []),
      { k: `list`, ordered: false, items: lines },
    ];
  }

  /**
   * A SummaryTable: a caption, an optional explainer and conclusion, and one row per item.
   *
   * A row is either a `{th, td}` pair — a label and its amount, which is the common shape — or a
   * single string spanning both cells. `SummaryTable.tsx` tells them apart the same way: by whether
   * the section's value is an object. Either cell may itself be a modal launcher.
   */
  private summaryTable(config: ContentConfig): Block[] {
    const key = this.r.namespaced(config.props.i18nKey as string);
    const items = (config.props.items as { itemKey: string }[] | undefined) ?? [];

    const rows: { th: Inline[]; td: Inline[] }[] = [];
    for (const item of items) {
      const sectionKey = `${key}.sections.${item.itemKey}`;
      const value = this.r.lookupValue(sectionKey);
      const paired = value !== null && typeof value === `object` && Object.hasOwn(value as object, `th`);
      const th = paired ? this.cell(`${sectionKey}.th`) : this.cell(sectionKey);
      const td = paired ? this.cell(`${sectionKey}.td`) : [];
      if (th.length > 0 || td.length > 0) rows.push({ th, td });
    }
    if (rows.length === 0) return [];

    const explainer = this.r.lookupValue(`${key}.sections.explainer`);
    const conclusion = this.r.lookupValue(`${key}.sections.conclusion`);
    return [
      ...(typeof explainer === `string` ? [{ k: `p` as const, t: this.r.inlineForKey(`${key}.sections.explainer`) }] : []),
      { k: `table`, caption: this.r.inlineForKey(`${key}.sections.caption`), rows },
      ...(typeof conclusion === `string` ? [{ k: `p` as const, t: this.r.inlineForKey(`${key}.sections.conclusion`) }] : []),
    ];
  }

  /** One table cell, which may be a plain string or a modal launcher. */
  private cell(key: string): Inline[] {
    return this.r.isModal(key) ? this.r.modalInline(key) : this.r.inlineForKey(key);
  }
}

interface ConditionalListItem {
  itemKey: string;
  editRoute?: string;
}

/**
 * The `<InternalLink>` url map for a route prop, or none.
 *
 * Direct File writes flow routes with a `/flow` prefix this port drops. A `/data-view/…` route names
 * the DataView, which this port does not have — the topic page is its review surface — so there is
 * nowhere to point and the tag is left unresolved on purpose, which counts it.
 */
function internalLinkUrl(route: string | undefined): Record<string, string> {
  if (route === undefined || route.startsWith(`/data-view`)) return {};
  return { InternalLink: route.replace(/^\/flow/, ``) };
}

/** A content declaration's own `condition` / `conditions`, as one list. */
function ownConditions(props: Record<string, unknown>): unknown[] {
  const single = props.condition;
  const many = props.conditions as unknown[] | undefined;
  return [...(single === undefined ? [] : [single]), ...(many ?? [])];
}

export { RENDERED_ELSEWHERE, OUT_OF_SCOPE, NOT_EXPRESSIBLE };
