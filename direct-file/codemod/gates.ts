/**
 * Stage 3 of the transpiler: Direct File's screen conditions, as synthesized Fact Graph facts.
 *
 * Form Builder allows one condition per element and offers seven operators. Direct File allows a
 * list, ANDed, over eight operators — and after `createFlowConfig` has flattened every ancestor
 * `<Gate>` onto the screen, most screens carry several. Rather than widen the condition parser to a
 * shape only this application needs, each distinct condition set becomes one derived Boolean fact in
 * `facts/flowGates.xml`, and the flow references it by a name built from its own conditions, e.g.
 * `condition="/isYoungerThan16"` or `condition="/isAllowsFilingMarriedAndIsNotUsCitizenFullYear"`.
 * See `gateName` below for how the conditions become that identifier.
 *
 * Every expansion below is **total** — it can be Complete(true) or Complete(false) but never
 * Incomplete — which is what `condition`/`operator` needs, since `checkCondition` treats an
 * Incomplete fact as false and would silently skip the screen. Totality comes from putting
 * `<IsComplete>` first inside `<All>`: AllOperator short-circuits on the first Complete(false), so
 * the Incomplete dependency behind it is never reduced. `<Any>` short-circuits on Complete(true) the
 * same way, which is what makes the `…OrIncomplete` pair total.
 *
 * ## The one approximation
 *
 * Direct File's `isTrue` is `hasValue && !!get`; its `isTrueAndComplete` is `complete && !!get`. The
 * Fact Graph offers `IsComplete` and no `HasValue`, so both map onto `complete`. The two differ only
 * for a fact that has a value but is not complete — a placeholder, or a derived fact with an
 * incomplete dependency. `isTrueAndComplete` and `isFalseAndComplete` appear in no flattened screen
 * condition at all, so in practice this is the `isTrue` row alone. A parity failure that traces back
 * here is real, and belongs in this comment rather than in a workaround.
 */
import type { FactKind } from './fact-types.ts';

/** A condition as `createFlowConfig` leaves it: a bare fact path, or a path with an operator. */
export type RawScreenCondition = string | { condition: string; operator?: string; section?: string };

/** What a condition became once folded and scoped. */
export type NormalizedCondition = { path: string; operator: string };

export interface GateContext {
  /** `screen.collectionContext`, e.g. `/primaryFiler`. */
  collectionContext: string | null;
  /** The collection a surrounding `<fg-collection>` will iterate, e.g. `/formW2s`. Null outside one. */
  loopCollection: string | null;
  /** For error messages. */
  screenRoute: string;
  /**
   * Whether a fold to false means the *screen* is gone.
   *
   * True for a screen's own conditions; false for a content declaration's, where folding to false
   * removes one paragraph and leaves the screen standing. Without the distinction, `dropped` — which
   * the manifest reports as screens — would count both.
   */
  recordDropped?: boolean;
}

export interface Gate {
  /** The fact path, e.g. `/isYoungerThan16` or `/filers/*\/isNotUsCitizenFullYear`. */
  factPath: string;
  /** What the `<div condition>` attribute carries. Identical to factPath. */
  conditionPath: string;
  /** `/filers` when the gate is defined on a collection item, null at the root. */
  scope: string | null;
  conditions: NormalizedCondition[];
  /** Screen routes that share this gate, for the manifest. */
  screens: string[];
}

/** A screen's conditions, resolved. */
export type ScreenGate =
  | { kind: 'always' }
  | { kind: 'never'; because: string }
  | { kind: 'gate'; gate: Gate };

/**
 * Conditions that name something other than a fact, and what they fold to here.
 *
 * The port has no data import and no e-signature path, so both are constants rather than gaps. Every
 * `data-import` condition folds to its "nothing was imported" branch, which is what leaves exactly
 * the hand-entry screens standing: `jobs-loop-intro` (isFalse → true) survives and
 * `jobs-loop-intro-data-import` (bare, so isTrue → false) does not.
 */
const NON_FACT_CONDITIONS: Record<string, boolean> = {
  // The value the operator is applied to, not the answer: `isFalse` of it is `true`.
  'data-import': false,
  isEssarSigningPath: false,
};

/** `isUnknown` has no fact-graph expansion; it only ever appears on a folded condition. */
function foldConstant(value: boolean, operator: string): boolean {
  switch (operator) {
    case 'isTrue':
      return value;
    case 'isFalse':
      return !value;
    // Nothing was imported, so the import's state is not merely false but unknown.
    case 'isUnknown':
      return !value;
    default:
      throw new Error(`no constant folding for operator "${operator}" on a non-fact condition`);
  }
}

const WILDCARD = /^(\/[A-Za-z0-9]+)\/\*\//;

/**
 * Put a condition path into the scope the gate will be defined in.
 *
 * Two rewrites, and both are forced by the port rather than chosen:
 *
 *   - **Outside a loop**, `/filers/*\/x` has no item to resolve against, because nothing on the page
 *     iterates `/filers`. Direct File resolves it from the screen's `collectionContext`, which for
 *     these 33 screens is always `/primaryFiler` or `/secondaryFiler` — both derived `<Find>` facts
 *     returning one filer. So the path becomes `/primaryFiler/x`, which the dictionary already uses
 *     in 106 places, and the gate sits at the root.
 *   - **Inside a loop**, the gate is defined on the collection item, so a path under that collection
 *     becomes relative: `/formW2s/*\/x` → `../x`. Paths under any other collection would be
 *     ambiguous, and no screen has them — asserted below rather than assumed.
 */
function scopePath(path: string, scope: string | null, context: GateContext): string {
  const match = WILDCARD.exec(path);
  if (!match) return path;
  const prefix = match[1];

  if (scope === null) {
    const filer = context.collectionContext;
    if (prefix !== `/filers` || (filer !== `/primaryFiler` && filer !== `/secondaryFiler`)) {
      throw new Error(
        `${context.screenRoute}: condition "${path}" has a collection wildcard but the screen is in ` +
          `no loop and its collectionContext is ${filer ?? `unset`}, so there is no item to resolve it against`
      );
    }
    return path.replace(WILDCARD, `${filer}/`);
  }

  if (prefix !== scope) {
    throw new Error(
      `${context.screenRoute}: condition "${path}" is under ${prefix}, but this gate is scoped to ` +
        `${scope}. A gate spanning two collections has no single item to resolve against.`
    );
  }
  // Left absolute. `expand` writes it relative to the gate's own scope, which is where the Fact Graph
  // needs `../`; keeping the absolute form here is what lets the manifest check it against the
  // dictionary's declared paths.
  return path;
}

/**
 * The scope a screen's conditions imply: the one collection whose wildcard they use, or null.
 *
 * A screen inside a loop whose conditions never mention that loop's collection is root-scoped, and
 * that is correct — nothing in it needs an item.
 */
function scopeFor(paths: string[], context: GateContext): string | null {
  const prefixes = new Set(paths.map((p) => WILDCARD.exec(p)?.[1]).filter((p): p is string => p !== undefined));
  if (prefixes.size === 0) return null;
  if (prefixes.size > 1) {
    throw new Error(`${context.screenRoute}: conditions span ${[...prefixes].join(`, `)}; a gate can hold only one`);
  }
  const prefix = [...prefixes][0];
  // Outside a loop there is no item to scope to; scopePath rewrites through /primaryFiler instead.
  return context.loopCollection === null ? null : prefix;
}

/** The canonical string a gate is named by: order-insensitive, so an author's reordering is free. */
function canonical(scope: string | null, conditions: NormalizedCondition[]): string {
  return [scope ?? `/`, ...conditions.map((c) => `${c.operator}:${c.path}`).sort()].join(`\n`);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

/** The last segment of a fact path: `/primaryFiler/youngerThan16` -> `youngerThan16`. */
function leafName(path: string): string {
  const segments = path.split(`/`).filter((s) => s.length > 0 && s !== `*`);
  const last = segments[segments.length - 1];
  if (last === undefined) throw new Error(`condition path "${path}" has no leaf segment to name a gate from`);
  return last;
}

/**
 * A fact's leaf name, as the positive assertion it already reads as.
 *
 * A leaf already spelled like a predicate — `isUsCitizenFullYear` — contributes its own claim
 * unchanged; `stripIsPrefix` removes the `is` so callers can re-prefix it (`is`, `isNot`) without
 * doubling up into `isIsUsCitizenFullYear`. A leaf that is just a noun — `youngerThan16`,
 * `filingStatus` — has no claim of its own yet, so it is only capitalized, ready for the same
 * prefixing.
 */
function stripIsPrefix(leaf: string): string {
  return leaf.length > 2 && leaf.startsWith(`is`) && /[A-Z]/.test(leaf[2]) ? leaf.slice(2) : capitalize(leaf);
}

/**
 * When two conditions in the same gate share a leaf name — `/primaryFiler/x` and
 * `/secondaryFiler/x` are the recurring case — the leaf alone can no longer tell them apart in the
 * gate's name. Qualifying with the immediate parent segment (`primaryFiler` + `x`) restores that
 * without changing the common case, where the leaf is already unique and this is never called.
 */
function qualifyLeaf(path: string, leaf: string): string {
  const segments = path.split(`/`).filter((s) => s.length > 0 && s !== `*`);
  const parent = segments.length > 1 ? segments[segments.length - 2] : undefined;
  return parent ? `${parent}${capitalize(leaf)}` : leaf;
}

/**
 * A handful of ported facts spell their own claim negatively — `notDigitalAssets`,
 * `cannotFindPinOrAgi`, `taxpayerCannotBeClaimed`, `couldntBeQCOfAnother` — because that is how
 * Direct File's own condition reads. Naming a gate's `isFalse` of one by mechanically prefixing
 * `isNot` stacks a second negative onto the leaf's own ("isNotNotDigitalAssets",
 * "isNotCouldntBeQCOfAnother"), which is the double negative this exists to prevent: it maps the
 * marker word back to what it would be if the leaf had been spelled positively, wherever in the
 * leaf it falls, so `assertFalse` can flip polarity instead of negating twice.
 */
const NEGATION_TO_POSITIVE: Record<string, string> = {
  Not: ``,
  Never: ``,
  Cannot: `Can`,
  Cant: `Can`,
  Couldnt: `Could`,
  Wont: `Will`,
  Wouldnt: `Would`,
  Shouldnt: `Should`,
  Mustnt: `Must`,
  Mightnt: `Might`,
  Isnt: `Is`,
  Doesnt: `Does`,
  Didnt: `Did`,
  Wasnt: `Was`,
  Werent: `Were`,
  Arent: `Are`,
};

/**
 * The reverse table, for negating a leaf that reads as a bare modal claim — `canBeClaimed`,
 * `willBeClaimed` — without prefixing `isNot` onto a modal, which is the "is not can be claimed"
 * kind of sentence this exists to prevent. `assertFalse` reaches for "cannotBeClaimed" instead.
 */
const MODAL_TO_NEGATIVE: Record<string, string> = {
  Can: `Cannot`,
  Could: `CouldNot`,
  Will: `WillNot`,
  Would: `WouldNot`,
  May: `MayNot`,
  Might: `MightNot`,
  Should: `ShouldNot`,
  Must: `MustNot`,
  Shall: `ShallNot`,
};

// Matched case-sensitively against an already-capitalized identifier, so this never fires inside an
// all-caps acronym (MFJ, QC, AGI, …): a real match is followed by a capital (the next word) or the
// end of the string, which an acronym's own trailing capitals never are.
const NEGATION_MARKER = new RegExp(`(${Object.keys(NEGATION_TO_POSITIVE).join(`|`)})(?=[A-Z]|$)`);
const LEADING_MODAL = new RegExp(`^(${Object.keys(MODAL_TO_NEGATIVE).join(`|`)})(?=[A-Z]|$)`);

/**
 * The claim `positive` makes with its own negation undone — "NotDigitalAssets" -> "DigitalAssets",
 * "TaxpayerCannotBeClaimed" -> "TaxpayerCanBeClaimed" — or undefined if it carries none. The marker
 * can fall anywhere in the identifier, not only at the front: a leaf ported as a compound claim
 * ("taxpayerCannotBeClaimed") still has exactly one negation word to invert.
 */
function positiveCore(positive: string): string | undefined {
  const match = NEGATION_MARKER.exec(positive);
  if (!match) return undefined;
  const word = match[1];
  return positive.slice(0, match.index) + NEGATION_TO_POSITIVE[word] + positive.slice(match.index + word.length);
}

/** The modal `positive` opens with, if it opens with one and carries no negation of its own. */
function leadingModal(positive: string): string | undefined {
  return LEADING_MODAL.exec(positive)?.[1];
}

/**
 * Fragment asserting `positive` is true: always `is${positive}`, modal-led claims included
 * ("isCanBeClaimed" reads as stilted rather than broken). Kept unconditional rather than reading as
 * the leaf's own name ("canBeClaimed") on purpose — a single-condition gate over `isTrue` of a leaf
 * would then be named identically to the leaf itself, and `reserveName` would have to break the tie
 * with a numeric suffix on every such gate rather than on the rare real collision.
 */
function assertTrue(positive: string): string {
  return `is${positive}`;
}

/**
 * Fragment asserting `positive` is false, without stacking a second negative onto one the leaf
 * already carries and without prefixing `isNot` onto a modal. A leaf that already reads negatively
 * flips to its positive core instead of doubling up ("isNotNotDigitalAssets" -> "isDigitalAssets").
 * A bare modal claim gets the modal's own negative instead of "isNot" glued in front of it — dropping
 * "is" here is load-bearing rather than cosmetic: "isNotCanBeClaimed" ("is not can be claimed") is
 * not grammatical English, while "cannotBeClaimed" is, and unlike the affirmative case a negated
 * modal ("cannotBeClaimed", "willNotBeClaimed") is not a leaf any fact in the dictionary is named
 * after, so this does not create the same collision risk `assertTrue` avoids by keeping its prefix.
 */
function assertFalse(positive: string): string {
  const core = positiveCore(positive);
  if (core !== undefined) return assertTrue(core);
  const modal = leadingModal(positive);
  if (modal) return lowerFirst(MODAL_TO_NEGATIVE[modal] + positive.slice(modal.length));
  return `isNot${positive}`;
}

/**
 * One condition, as the identifier fragment it contributes to a gate's name.
 *
 * Existential (`isComplete`/`isIncomplete`), logical (`OrIncomplete`) and boolean (`is`/`isNot`)
 * operators each spell differently, so a gate's name reads as the condition set it was built from
 * rather than a hash of it. `leaf` is the fact's own leaf name, already qualified by `gateName` if a
 * sibling condition needed it distinguished. `assertTrue`/`assertFalse` are what keep that spelling
 * from stacking a negative or a modal onto one the leaf already carries.
 */
function conditionFragment(condition: NormalizedCondition, leaf: string): string {
  const positive = stripIsPrefix(leaf);
  switch (condition.operator) {
    case `isTrue`:
    case `isTrueAndComplete`:
      return assertTrue(positive);
    case `isFalse`:
    case `isFalseAndComplete`:
      return assertFalse(positive);
    case `isTrueOrIncomplete`:
      return `${assertTrue(positive)}OrIncomplete`;
    case `isFalseOrIncomplete`:
      return `${assertFalse(positive)}OrIncomplete`;
    case `isComplete`:
      return `${lowerFirst(positive)}IsKnown`;
    case `isIncomplete`:
      return `${lowerFirst(positive)}IsUnknown`;
    default:
      throw new Error(`no name fragment for condition operator "${condition.operator}"`);
  }
}

/**
 * The name a gate's own condition set spells out, e.g. `isYoungerThan16` for one condition, or
 * `isAllowsFilingMarriedAndIsNotUsCitizenFullYear` for two ANDed together. `GateSet.resolve`
 * disambiguates two different condition sets that happen to spell the same name.
 */
function gateName(conditions: NormalizedCondition[]): string {
  const leaves = conditions.map((c) => leafName(c.path));
  const occurrences = new Map<string, number>();
  for (const leaf of leaves) occurrences.set(leaf, (occurrences.get(leaf) ?? 0) + 1);

  // Every fragment already starts lowercase (`is`/`isNot`/a leaf name); capitalizing all but the
  // first before joining is what keeps "…And" followed by "is…" from reading as "Andis…".
  return conditions
    .map((c, i) => {
      const leaf = (occurrences.get(leaves[i]) ?? 0) > 1 ? qualifyLeaf(c.path, leaves[i]) : leaves[i];
      const fragment = conditionFragment(c, leaf);
      return i === 0 ? fragment : capitalize(fragment);
    })
    .join(`And`);
}

/**
 * The fact an element that must always show hangs its condition on.
 *
 * `<fg-alert>` renders hidden unless something drives it — the element exists for fact-driven alerts
 * and its template writes `class="hidden"` when `condition` is absent. Direct File's alerts are shown
 * whenever their screen is, and the screen div already carries that gate, so an alert with no
 * condition of its own needs a condition that is simply true. `<True/>` is a registered CompNode
 * (`BooleanNode.scala`), so this costs one fact rather than a library change.
 */
export const ALWAYS_TRUE_PATH = `/flowAlwaysTrue`;

/** Where a gate named `name` in `scope` is declared. The one place the two spellings live. */
function gateFactPath(scope: string | null, name: string): string {
  return scope === null ? `/${name}` : `${scope}/*/${name}`;
}

export class GateSet {
  private readonly byCanonical = new Map<string, Gate>();
  /**
   * Names already handed out, per scope (root and each collection are independent namespaces since
   * they occupy different fact paths). Two condition sets can spell the same name — e.g. one
   * screen's `isFalse` of a fact and another's `isIncomplete` of a sibling with a similar leaf — so a
   * repeat gets a numeric suffix rather than silently colliding.
   *
   * Gates are not the only occupants of those namespaces, which is the other half of `reserveName`.
   */
  private readonly namesByScope = new Map<string, Set<string>>();
  /** Screens folded away entirely, and why. For the manifest. */
  readonly dropped: { screen: string; because: string }[] = [];
  /** Set once something asks for it, so the fact is emitted only when the flow references it. */
  private usesAlwaysTrue = false;

  /**
   * Whether the application's dictionary already declares a fact at a path, with the generated gate
   * file itself excluded. A constructor argument rather than a default, because a `GateSet` built
   * without it hands out names that collide, and the failure is a hang rather than an error.
   *
   * Written as a field and an assignment rather than a parameter property: the transpiler runs under
   * node's strip-only TypeScript, which rejects the shorthand.
   */
  private readonly isDeclared: (factPath: string) => boolean;

  constructor(isDeclared: (factPath: string) => boolean) {
    this.isDeclared = isDeclared;
  }

  /**
   * Reserve `base` in `scope`'s namespace, appending `2`, `3`, … the first time it is already taken.
   *
   * "Taken" means by another gate **or by the dictionary**. Naming a gate after its own conditions
   * puts it in the same namespace as the facts those conditions name, and Direct File's dictionary
   * already spells many of them the same way: a gate over `isTrue(/filingStatus)` wants to be called
   * `isFilingStatusMFJ`, and `filingStatus.xml` declares `/isFilingStatusMFJ`.
   *
   * The consequence of not checking is worse than a confusing name. Two `<Fact path="…">` with one
   * path is not an error in the Fact Graph — the second definition replaces the first — so the gate
   * silently becomes the fact it was derived from, and its body still depends on that path. 26 of
   * this port's 32 collisions were self-referential like that, and `FactDictionary.freeze` walked the
   * cycle forever: `make site` hung with no output and no stack, and `verify-visibility.ts` reported
   * the gate as a path that "was not found".
   */
  private reserveName(scope: string | null, base: string): string {
    const scopeKey = scope ?? `/`;
    let taken = this.namesByScope.get(scopeKey);
    if (!taken) {
      taken = new Set();
      this.namesByScope.set(scopeKey, taken);
    }
    let name = base;
    for (let suffix = 2; taken.has(name) || this.isDeclared(gateFactPath(scope, name)); suffix++) {
      name = `${base}${suffix}`;
    }
    taken.add(name);
    return name;
  }

  /** The always-true fact's path, marking it as needed. */
  alwaysTrue(): string {
    this.usesAlwaysTrue = true;
    return ALWAYS_TRUE_PATH;
  }

  get needsAlwaysTrue(): boolean {
    return this.usesAlwaysTrue;
  }

  /** Every gate, in first-seen order, so regeneration produces a stable file. */
  get gates(): Gate[] {
    return [...this.byCanonical.values()];
  }

  /**
   * The gate a screen already resolved to, or null if its conditions were empty.
   *
   * Only for reading a decision back: a collection inherits its hub screen's visibility, and the hub
   * is a screen this has already been asked about. It never creates one.
   */
  gateFor(screenRoute: string): string | null {
    for (const gate of this.byCanonical.values()) {
      if (gate.screens.includes(screenRoute)) return gate.conditionPath;
    }
    return null;
  }

  resolve(rawConditions: RawScreenCondition[], context: GateContext): ScreenGate {
    const normalized: NormalizedCondition[] = [];

    for (const raw of rawConditions) {
      const path = typeof raw === `string` ? raw : raw.condition;
      const operator = (typeof raw === `string` ? undefined : raw.operator) ?? `isTrue`;

      if (!path.startsWith(`/`)) {
        const constant = NON_FACT_CONDITIONS[path];
        if (constant === undefined) {
          throw new Error(`${context.screenRoute}: condition "${path}" is neither a fact path nor a known constant`);
        }
        if (!foldConstant(constant, operator)) {
          const because = `${operator}(${path}) is false in this port`;
          if (context.recordDropped !== false) this.dropped.push({ screen: context.screenRoute, because });
          return { kind: `never`, because };
        }
        continue; // folded to true: contributes nothing to the AND
      }
      normalized.push({ path, operator });
    }

    if (normalized.length === 0) return { kind: `always` };

    const scope = scopeFor(
      normalized.map((c) => c.path),
      context
    );
    const scoped = normalized.map((c) => ({ operator: c.operator, path: scopePath(c.path, scope, context) }));

    const key = canonical(scope, scoped);
    const existing = this.byCanonical.get(key);
    if (existing) {
      existing.screens.push(context.screenRoute);
      return { kind: `gate`, gate: existing };
    }

    const name = this.reserveName(scope, gateName(scoped));
    const factPath = gateFactPath(scope, name);
    const gate: Gate = {
      factPath,
      conditionPath: factPath,
      scope,
      conditions: scoped,
      screens: [context.screenRoute],
    };
    this.byCanonical.set(key, gate);
    return { kind: `gate`, gate };
  }
}

const INDENT = `        `;

/**
 * How a fact of each type answers "is this truthy?" — Direct File's `!!fact.get`, written as a
 * Boolean CompNode tree.
 *
 * A condition may name a fact of any type: `Condition.evaluate` ends in `!!fact.get` and JavaScript
 * coerces. The Fact Graph does not — `<All>` rejects a non-Boolean child from inside
 * `All.fromDerivedConfig`, with nothing in the message naming the gate — so the test is written out,
 * against the type `fact-types.ts` reads out of the dictionary.
 *
 * `object` collapsing to the `<IsComplete>` guard the expansion already emits is the one that looks
 * like a shortcut and is not. A `Dollar`, `Day`, `Enum` or collection item crosses into JavaScript as
 * an opaque Scala object (`interface Dollar {}` in `js-factgraph-scala/src/typings/DollarFactory.d.ts`),
 * and an object is always truthy — so upstream, `!!get` on one *is* "has a value", zero included.
 * `interest.xml`'s five bond-premium accordions are conditioned on Dollar facts that default to
 * `<Dollar>0</Dollar>`, and upstream they show whenever the 1099-INT is complete. This reproduces
 * that, rather than the "is it nonzero" the condition looks like it wants.
 */
type Truthiness = (path: string, pad: string) => string;

const TRUTHINESS: Partial<Record<FactKind, Truthiness>> = {
  boolean: (path, pad) => `${pad}<Dependency path="${path}" />`,
  // Exactly `!!get` on a bare JS number: nonzero, sign included. `<NotEqual>` compares any two nodes
  // of one class, so an Int against `<Int>0</Int>` needs no assumption about the fact's range.
  int: (path, pad) =>
    `${pad}<NotEqual>\n${pad}  <Left>\n${pad}    <Dependency path="${path}" />\n${pad}  </Left>\n` +
    `${pad}  <Right>\n${pad}    <Int>0</Int>\n${pad}  </Right>\n${pad}</NotEqual>`,
  object: (path, pad) => `${pad}<IsComplete>\n${pad}  <Dependency path="${path}" />\n${pad}</IsComplete>`,
};

/**
 * The truthiness test for a fact, or a message saying why there is not one.
 *
 * `string` and `numeric` throw rather than guess. A JS string is falsy when empty and the Fact Graph
 * has no length CompNode to say that with; `<Add>` is an Int over Ints and a Dollar over Dollars, and
 * picking the wrong one turns a zero total into `true`. Neither is reachable from any condition
 * today, and if one becomes reachable the answer is a line here rather than a default.
 */
function truthiness(kind: FactKind, path: string, screen: string): Truthiness {
  const test = TRUTHINESS[kind];
  if (test) return test;
  throw new Error(
    `condition "${path}" (from ${screen}) names a fact of kind "${kind}", which has no truthiness ` +
      `test in gates.ts. Add one there, or correct what fact-types.ts resolves the path to.`
  );
}

/** The path as the gate's own scope sees it: `/filers/*\/x` becomes `../x` inside `/filers/*\/gate`. */
function relativeTo(path: string, scope: string | null): string {
  return scope !== null && path.startsWith(`${scope}/*/`) ? `../${path.slice(scope.length + 3)}` : path;
}

/** One condition, as the Boolean CompNode tree that reproduces `PathCondition.evaluate`. */
function expand(condition: NormalizedCondition, gate: Gate, pad: string, kindOf: KindOf): string {
  const path = relativeTo(condition.path, gate.scope);
  const test = truthiness(kindOf(condition.path), condition.path, gate.screens[0]);
  const dep = (p: string) => test(path, p);
  // `<IsComplete>` takes any node, so completeness always reads the fact itself.
  const rawDep = (p: string) => `${p}<Dependency path="${path}" />`;
  const complete = (p: string) => `${p}<IsComplete>\n${rawDep(`${p}  `)}\n${p}</IsComplete>`;
  const not = (p: string, inner: string) => `${p}<Not>\n${inner}\n${p}</Not>`;

  switch (condition.operator) {
    // `isTrue` and a bare path are the same thing; see the approximation note at the top.
    // `isTrueAndComplete` shares the expansion rather than approximating it: `complete && !!get` is
    // exactly what this tree says, and it is `isTrue` — `hasValue && !!get` — that the Fact Graph
    // has no `HasValue` for. The same pairing holds for `isFalse` and `isFalseAndComplete`.
    case `isTrue`:
    case `isTrueAndComplete`:
      // For an `object` fact the truthiness test *is* the completeness guard, and `<All>` of one
      // thing twice reads as a mistake. Emit the guard alone.
      return dep(`${pad}`) === complete(`${pad}`)
        ? complete(pad)
        : `${pad}<All>\n${complete(`${pad}  `)}\n${dep(`${pad}  `)}\n${pad}</All>`;
    case `isFalse`:
    case `isFalseAndComplete`:
      return `${pad}<All>\n${complete(`${pad}  `)}\n${not(`${pad}  `, dep(`${pad}    `))}\n${pad}</All>`;
    case `isTrueOrIncomplete`:
      return `${pad}<Any>\n${not(`${pad}  `, complete(`${pad}    `))}\n${dep(`${pad}  `)}\n${pad}</Any>`;
    case `isFalseOrIncomplete`:
      return `${pad}<Any>\n${not(`${pad}  `, complete(`${pad}    `))}\n${not(`${pad}  `, dep(`${pad}    `))}\n${pad}</Any>`;
    case `isComplete`:
      return complete(pad);
    case `isIncomplete`:
      return not(pad, complete(`${pad}  `));
    default:
      throw new Error(`no expansion for condition operator "${condition.operator}"`);
  }
}

function describe(gate: Gate): string {
  const set = gate.conditions.map((c) => `${c.operator}(${c.path})`).join(` and `);
  return `Screen gate: ${set}.`;
}

const ALWAYS_TRUE_FACT =
  `    <Fact path="${ALWAYS_TRUE_PATH}">\n` +
  `      <Description>Always true. What an element that must always show hangs its condition on: ` +
  `&lt;fg-alert&gt; renders hidden unless something drives it, and a Direct File alert is shown ` +
  `whenever its screen is.</Description>\n` +
  `      <Derived>\n        <True/>\n      </Derived>\n` +
  `    </Fact>`;

/** What a condition's fact holds, as `fact-types.ts` reads it out of the dictionary. */
export type KindOf = (path: string) => FactKind;

/** The whole of `facts/flowGates.xml`. */
export function renderGateFacts(gates: Gate[], includeAlwaysTrue: boolean, kindOf: KindOf): string {
  const facts = gates
    .map((gate) => {
      const body =
        gate.conditions.length === 1
          ? expand(gate.conditions[0], gate, `${INDENT}`, kindOf)
          : `${INDENT}<All>\n${gate.conditions
              .map((c) => expand(c, gate, `${INDENT}  `, kindOf))
              .join(`\n`)}\n${INDENT}</All>`;
      return (
        `    <Fact path="${gate.factPath}">\n` +
        `      <Description>${describe(gate)}</Description>\n` +
        `      <Derived>\n${body}\n      </Derived>\n` +
        `    </Fact>`
      );
    })
    .join(`\n\n`);
  const all = includeAlwaysTrue ? `${ALWAYS_TRUE_FACT}\n\n${facts}` : facts;

  return (
    `<?xml-model href="./FactDictionaryModule.rng"?>\n` +
    `<!-- GENERATED by src/scripts/to-form-builder from Direct File's flow. Do not edit: regenerate.\n\n` +
    `     One fact per distinct set of screen conditions. Direct File ANDs a list of conditions over\n` +
    `     eight operators; Form Builder's \`condition\`/\`operator\` pair takes one fact and one of\n` +
    `     seven. So the set becomes a fact, and the flow carries a condition naming it, e.g.\n` +
    `     \`condition="/isYoungerThan16"\`.\n\n` +
    `     Every fact here is total — never Incomplete — because \`checkCondition\` reads an Incomplete\n` +
    `     fact as false and would skip the screen rather than show it. See gates.ts for how\n` +
    `     \`<All>\`/\`<Any>\` short-circuiting delivers that, and for the one \`isTrue\` approximation.\n\n` +
    `     Named by its own condition set — the existential (isComplete/isIncomplete), logical\n` +
    `     (OrIncomplete) and boolean (is/isNot) operators applied to the fact(s) it gates, ANDed\n` +
    `     conditions joined by "And" — so identical sets collapse to one fact and a name reads as\n` +
    `     what it gates rather than a hash of it. See \`gateName\` in gates.ts. -->\n` +
    `<FactDictionaryModule>\n  <Facts>\n${all}\n  </Facts>\n</FactDictionaryModule>\n`
  );
}
