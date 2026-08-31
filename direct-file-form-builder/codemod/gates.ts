/**
 * Stage 3 of the transpiler: Direct File's screen conditions, as synthesized Fact Graph facts.
 *
 * Form Builder allows one condition per element and offers seven operators. Direct File allows a
 * list, ANDed, over eight operators — and after `createFlowConfig` has flattened every ancestor
 * `<Gate>` onto the screen, most screens carry several. Rather than widen the condition parser to a
 * shape only this application needs, each distinct condition set becomes one derived Boolean fact in
 * `facts/flowGates.xml`, and the flow references it as `condition="/flowGateXXXXXXXX"`.
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
import { createHash } from 'crypto';

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
}

export interface Gate {
  /** The fact path, e.g. `/flowGate1a2b3c4d` or `/filers/*\/flowGate1a2b3c4d`. */
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

export class GateSet {
  private readonly byCanonical = new Map<string, Gate>();
  /** Screens folded away entirely, and why. For the manifest. */
  readonly dropped: { screen: string; because: string }[] = [];

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
          this.dropped.push({ screen: context.screenRoute, because });
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

    const name = `flowGate${createHash(`sha256`).update(key).digest(`hex`).slice(0, 8)}`;
    const factPath = scope === null ? `/${name}` : `${scope}/*/${name}`;
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
 * Screen conditions whose fact is not Boolean, and the truthiness test each needs.
 *
 * Direct File's `PathCondition.evaluate` ends in `!!get`, so a condition may name a fact of any type
 * and get JavaScript truthiness. The Fact Graph has no such coercion — `<All>` rejects a non-Boolean
 * child outright — so every one of these needs its comparison written out. There is exactly one
 * today, and a new one upstream fails the Scala build with "all children of <All> must be
 * BooleanNodes", which is what points back here.
 *
 * `int`: `> 0` rather than `!= 0`, because the only such fact is a `<Count>` and cannot be negative.
 * A signed fact would need `NotEqual` instead, and belongs in a second case rather than this one.
 */
const NON_BOOLEAN_CONDITIONS: Record<string, 'int'> = {
  '/claimedDependentsCount': `int`,
};

/** The path as the gate's own scope sees it: `/filers/*\/x` becomes `../x` inside `/filers/*\/gate`. */
function relativeTo(path: string, scope: string | null): string {
  return scope !== null && path.startsWith(`${scope}/*/`) ? `../${path.slice(scope.length + 3)}` : path;
}

/** One condition, as the Boolean CompNode tree that reproduces `PathCondition.evaluate`. */
function expand(condition: NormalizedCondition, scope: string | null, pad: string): string {
  const path = relativeTo(condition.path, scope);
  const truthy = NON_BOOLEAN_CONDITIONS[condition.path];
  const dep = (p: string) =>
    truthy === undefined
      ? `${p}<Dependency path="${path}" />`
      : `${p}<GreaterThan>\n${p}  <Left>\n${p}    <Dependency path="${path}" />\n${p}  </Left>\n` +
        `${p}  <Right>\n${p}    <Int>0</Int>\n${p}  </Right>\n${p}</GreaterThan>`;
  // `<IsComplete>` takes any node, so completeness always reads the fact itself.
  const rawDep = (p: string) => `${p}<Dependency path="${path}" />`;
  const complete = (p: string) => `${p}<IsComplete>\n${rawDep(`${p}  `)}\n${p}</IsComplete>`;
  const not = (p: string, inner: string) => `${p}<Not>\n${inner}\n${p}</Not>`;

  switch (condition.operator) {
    // `isTrue` and a bare path are the same thing; see the approximation note at the top.
    case `isTrue`:
      return `${pad}<All>\n${complete(`${pad}  `)}\n${dep(`${pad}  `)}\n${pad}</All>`;
    case `isFalse`:
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

/** The whole of `facts/flowGates.xml`. */
export function renderGateFacts(gates: Gate[]): string {
  const facts = gates
    .map((gate) => {
      const body =
        gate.conditions.length === 1
          ? expand(gate.conditions[0], gate.scope, `${INDENT}`)
          : `${INDENT}<All>\n${gate.conditions
              .map((c) => expand(c, gate.scope, `${INDENT}  `))
              .join(`\n`)}\n${INDENT}</All>`;
      return (
        `    <Fact path="${gate.factPath}">\n` +
        `      <Description>${describe(gate)}</Description>\n` +
        `      <Derived>\n${body}\n      </Derived>\n` +
        `    </Fact>`
      );
    })
    .join(`\n\n`);

  return (
    `<?xml-model href="./FactDictionaryModule.rng"?>\n` +
    `<!-- GENERATED by src/scripts/to-form-builder from Direct File's flow. Do not edit: regenerate.\n\n` +
    `     One fact per distinct set of screen conditions. Direct File ANDs a list of conditions over\n` +
    `     eight operators; Form Builder's \`condition\`/\`operator\` pair takes one fact and one of\n` +
    `     seven. So the set becomes a fact, and the flow carries \`condition="/flowGateXXXXXXXX"\`.\n\n` +
    `     Every fact here is total — never Incomplete — because \`checkCondition\` reads an Incomplete\n` +
    `     fact as false and would skip the screen rather than show it. See gates.ts for how\n` +
    `     \`<All>\`/\`<Any>\` short-circuiting delivers that, and for the one \`isTrue\` approximation.\n\n` +
    `     Named by a hash of the normalized condition set, so identical sets collapse to one fact and\n` +
    `     regenerating after an unrelated change leaves these names alone. -->\n` +
    `<FactDictionaryModule>\n  <Facts>\n${facts}\n  </Facts>\n</FactDictionaryModule>\n`
  );
}
