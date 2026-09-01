/**
 * What type each fact in the application's dictionary holds — enough of it to write a truthiness
 * test.
 *
 * Direct File's `Condition.evaluate` ends in `!!fact.get`, so a screen condition may name a fact of
 * *any* type and get JavaScript truthiness for free. The Fact Graph has no such coercion: `<All>`
 * rejects a non-Boolean child outright, and does it from inside `All.fromDerivedConfig` with nothing
 * in the message naming the condition, the gate or the screen. So before `gates.ts` can expand a
 * condition it has to know what the fact holds, and that answer lives in the dictionary rather than
 * in a table someone maintains by hand.
 *
 * ## What truthiness means per type
 *
 * The types are the ones `js-factgraph-scala` exports, and the distinction that matters is whether
 * the value crosses into JavaScript as a primitive or as an object:
 *
 *   - **boolean** — the value itself. No wrapping.
 *   - **int** — a bare JS number, so `0` is falsy: the test is `!= 0`.
 *   - **object** — `Dollar`, `Day`, `Enum`, `Address`, a collection item… all opaque Scala objects on
 *     the JS side (see `js-factgraph-scala/src/typings/*.d.ts`, where `Dollar` is `interface Dollar
 *     {}`). An object is *always* truthy, so `!!get` is indistinguishable from "has a value" — and
 *     `<IsComplete>`, which the expansion already puts in front of every condition for totality, is
 *     exactly that. The test collapses to that guard alone.
 *   - **string** — a real JS string, where `""` is falsy. There is no `<Length>` CompNode to write
 *     that with, so this throws rather than guessing. No condition names one today.
 *   - **numeric** — arithmetic whose scale depends on its operands (`<Add>` over Ints is an Int;
 *     over Dollars, a Dollar). Deliberately *not* collapsed into `object`: guessing wrong here is
 *     silent — a zero total would read as true — so it throws and asks for the one-line answer.
 *
 * ## Resolution
 *
 * A condition rarely names a fact the dictionary declares verbatim. `/primaryFiler/hasIpPin` reads
 * through a `<Find>` over `/filers` to `/filers/*\/hasIpPin`; `/formW2s/*\/filer/isPrimaryFiler`
 * through a `<CollectionItem collection="/filers">`; `/firstHohQP/isClaimedDependent` through an
 * `<IndexOf>`. So `resolve` walks down to the longest declared prefix, asks what collection that
 * prefix stands for, and continues under `<collection>/*\/`. Heads that only forward — `<Dependency>`,
 * `<Switch>` (through its first `<Then>`) — are followed the same way.
 *
 * This is a small, regex-shaped reader rather than an XML parse, for the same reason `emit.ts` reads
 * declared paths with a regex: the transpiler runs under bare `node` with no dependencies, and the
 * dictionary it reads is one it copied itself.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export type FactKind = 'boolean' | 'int' | 'object' | 'string' | 'numeric' | 'unknown';

/** The head element of each fact, keyed by tag name. Every tag the dictionary uses is here. */
const TAG_KIND: Record<string, FactKind> = {
  // Booleans: the writable type, the two literals, and every predicate.
  Boolean: `boolean`,
  True: `boolean`,
  False: `boolean`,
  All: `boolean`,
  Any: `boolean`,
  Not: `boolean`,
  Equal: `boolean`,
  NotEqual: `boolean`,
  GreaterThan: `boolean`,
  GreaterThanOrEqual: `boolean`,
  LessThan: `boolean`,
  LessThanOrEqual: `boolean`,
  IsComplete: `boolean`,
  EnumOptionsContains: `boolean`,

  // Bare JS numbers.
  Int: `int`,
  Count: `int`,
  CollectionSize: `int`,

  // Opaque Scala objects on the JS side.
  Dollar: `object`,
  Round: `object`, // rounds a Dollar to a Dollar
  Rational: `object`,
  Day: `object`,
  Enum: `object`,
  EnumOptions: `object`,
  MultiEnum: `object`,
  Address: `object`,
  BankAccount: `object`,
  EIN: `object`,
  TIN: `object`,
  PIN: `object`,
  IPPIN: `object`,
  PhoneNumber: `object`,
  EmailAddress: `object`,
  Collection: `object`,
  CollectionItem: `object`,
  Filter: `object`,
  Find: `object`,
  IndexOf: `object`,

  // JS strings, where "" is falsy.
  String: `string`,
  Trim: `string`,
  AsString: `string`,
  StripChars: `string`,
  TruncateNameForMeF: `string`,
  Paste: `string`,

  // Numbers whose scale follows their operands.
  Add: `numeric`,
  Subtract: `numeric`,
  Multiply: `numeric`,
  Divide: `numeric`,
  GreaterOf: `numeric`,
  LesserOf: `numeric`,
  CollectionSum: `numeric`,
  StepwiseMultiply: `numeric`,
};

/**
 * The members a typed value exposes as a path segment, and what each holds.
 *
 * `/primaryFiler/tin/isSSN` is not a fact: `/filers/*\/tin` is, and `isSSN` is a child the Fact
 * Graph's `TinNode` synthesizes (`PathItem.Child(Symbol("isSSN"))`). This is every such member in
 * the engine — `TinNode`, `DayNode`, `AddressNode`, `BankAccountNode` — so a path that ends in one
 * resolves rather than falling through to `unknown`.
 */
const MEMBER_KIND: Record<string, FactKind> = {
  isSSN: `boolean`,
  isITIN: `boolean`,
  isATIN: `boolean`,
  foreignAddress: `boolean`,
  day: `int`,
  month: `int`,
  year: `int`,
  ordinal: `int`,
  city: `string`,
  country: `string`,
  postalCode: `string`,
  stateOrProvence: `string`,
  streetAddress: `string`,
  streetAddressLine2: `string`,
  accountNumber: `string`,
  routingNumber: `string`,
  accountType: `object`,
};

interface Entry {
  /** The `<Derived>`/`<Writable>` body, comments already stripped. */
  body: string;
  /** Which file it came from, for error messages. */
  file: string;
}

interface Element {
  tag: string;
  attrs: string;
  /** The element's own content, with nesting balanced. */
  inner: string;
}

/**
 * The first element in a fragment — optionally the first with a given name — with its content.
 *
 * Depth-counted rather than regex-terminated, because the dictionary nests `<Switch>` inside
 * `<Then>` inside `<Switch>` freely, and a non-greedy `</Switch>` would close the outer element on
 * the inner one's tag and silently truncate everything after it.
 */
function element(xml: string, name?: string): Element | null {
  const tags = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let open: { tag: string; attrs: string; contentAt: number } | null = null;
  let depth = 0;
  for (let match = tags.exec(xml); match !== null; match = tags.exec(xml)) {
    const [text, closing, tag, attrs, selfClosing] = match;
    if (open === null) {
      if (closing === `/` || (name !== undefined && tag !== name)) continue;
      if (selfClosing === `/`) return { tag, attrs, inner: `` };
      open = { tag, attrs, contentAt: match.index + text.length };
      depth = 1;
      continue;
    }
    if (tag !== open.tag || selfClosing === `/`) continue;
    depth += closing === `/` ? -1 : 1;
    if (depth === 0) return { tag: open.tag, attrs: open.attrs, inner: xml.slice(open.contentAt, match.index) };
  }
  // An unbalanced open tag can only mean the fact reader sliced the file wrong; say so rather than
  // returning a fragment that is missing its tail.
  if (open !== null) throw new Error(`<${open.tag}> is never closed in: ${xml.slice(0, 200)}`);
  return null;
}

function attr(attrs: string, name: string): string | null {
  const value = new RegExp(`\\s${name}=("([^"]*)"|'([^']*)')`).exec(attrs)?.slice(2).find((v) => v !== undefined);
  // Trimmed: `ptc.xml` carries `path="/writableDependentsRequiredToFile "`, and the Fact Graph
  // accepts it, so reading it strictly would report a fact the application resolves fine as missing.
  return value === undefined ? null : value.trim();
}

/**
 * `../x` against `/formW2s/*\/y` is `/formW2s/*\/x`; an absolute path is itself.
 *
 * `..` is the fact's parent *node*, which for a fact on a collection item is the item — so it pops
 * one segment off the owner's own path, not two. `filers.xml` writes a bare `<Dependency path=".." />`
 * to mean "this filer", which is the same rule read at its shortest.
 */
function against(path: string, owner: string): string | null {
  if (path.startsWith(`/`)) return path;
  const segments = owner.split(`/`);
  for (const part of path.split(`/`)) {
    if (part === `..`) segments.pop();
    else if (part !== `.` && part !== ``) segments.push(part);
  }
  const joined = segments.join(`/`);
  return joined.startsWith(`/`) ? joined : null;
}

export class FactTypes {
  private readonly entries = new Map<string, Entry>();
  private readonly kinds = new Map<string, FactKind>();

  constructor(factsDir: string, skip: string[] = []) {
    for (const name of readdirSync(factsDir)) {
      if (!name.endsWith(`.xml`) || skip.includes(name)) continue;
      const xml = readFileSync(join(factsDir, name), `utf8`).replace(/<!--[\s\S]*?-->/g, ``);
      for (const match of xml.matchAll(/<Fact\s+path=("([^"]+)"|'([^']+)')\s*>([\s\S]*?)<\/Fact>/g)) {
        const path = match[2] ?? match[3];
        // `<Placeholder>` last: it is the value only until the writable is answered, and a fact with
        // both is typed by the writable.
        const head =
          /<(?:Writable|Derived)\s*>([\s\S]*?)<\/(?:Writable|Derived)>/.exec(match[4]) ??
          /<Placeholder\s*>([\s\S]*?)<\/Placeholder>/.exec(match[4]);
        if (head) this.entries.set(path, { body: head[1], file: name });
      }
    }
  }

  /** Whether the dictionary declares this exact path. */
  has(path: string): boolean {
    return this.entries.has(path);
  }

  /**
   * The declared fact a reference lands on, following collection aliases, or null.
   *
   * `seen` guards the one cycle the dictionary can express: an alias whose own definition reads back
   * through itself.
   */
  resolve(path: string, seen = new Set<string>()): string | null {
    if (this.entries.has(path)) return path;
    if (seen.has(path)) return null;
    seen.add(path);

    const segments = path.split(`/`);
    for (let end = segments.length - 1; end > 1; end--) {
      const prefix = segments.slice(0, end).join(`/`);
      if (!this.entries.has(prefix)) continue;
      const collection = this.collectionOf(prefix, seen);
      if (collection === null) return null;
      return this.resolve(`${collection}/*/${segments.slice(end).join(`/`)}`, seen);
    }
    return null;
  }

  /** The collection a fact standing for one of its items iterates, or null if it stands for none. */
  private collectionOf(path: string, seen: Set<string>): string | null {
    const entry = this.entries.get(path);
    if (!entry) return null;
    return this.collectionOfFragment(entry.body, path, seen);
  }

  private collectionOfFragment(xml: string, owner: string, seen: Set<string>): string | null {
    const head = element(xml);
    if (!head) return null;
    switch (head.tag) {
      case `CollectionItem`:
        return attr(head.attrs, `collection`);
      case `Find`:
      case `Filter`:
        // `<Find path="/filers">` names it outright; `<Filter>` wraps a `<Dependency>` on it.
        return attr(head.attrs, `path`) ?? this.collectionOfFragment(head.inner, owner, seen);
      case `IndexOf`:
      case `Collection`:
        return this.collectionOfFragment(head.inner, owner, seen);
      case `Dependency`: {
        const target = attr(head.attrs, `path`);
        const resolved = target === null ? null : against(target, owner);
        if (resolved === null || seen.has(resolved)) return null;
        seen.add(resolved);
        // A dependency on the collection itself (`/formW2s`) rather than on an item alias.
        if (this.entries.has(resolved) && element(this.entries.get(resolved)!.body)?.tag === `Collection`) {
          return resolved;
        }
        return this.collectionOf(resolved, seen);
      }
      case `Switch`: {
        const then = element(head.inner, `Then`);
        return then ? this.collectionOfFragment(then.inner, owner, seen) : null;
      }
      default:
        // A `<Writable><Collection/></Writable>` is the collection, and `/formW2s/*` is its item.
        return head.tag === `Collection` ? owner : null;
    }
  }

  /** What a reference to this path holds. `unknown` when the dictionary cannot be followed to it. */
  kindOf(path: string): FactKind {
    const cached = this.kinds.get(path);
    if (cached !== undefined) return cached;
    const kind = this.kindOfPath(path, new Set());
    this.kinds.set(path, kind);
    return kind;
  }

  /** A reference, whether it names a fact or a member of one. */
  private kindOfPath(path: string, seen: Set<string>): FactKind {
    const resolved = this.resolve(path);
    return resolved !== null ? this.kindOfFact(resolved, seen) : this.kindOfMember(path);
  }

  /** A path that is a typed value's member rather than a fact of its own, or `unknown`. */
  private kindOfMember(path: string): FactKind {
    const cut = path.lastIndexOf(`/`);
    if (cut <= 0) return `unknown`;
    const kind = MEMBER_KIND[path.slice(cut + 1)];
    return kind !== undefined && this.resolve(path.slice(0, cut)) !== null ? kind : `unknown`;
  }

  private kindOfFact(path: string, seen: Set<string>): FactKind {
    if (seen.has(path)) return `unknown`;
    seen.add(path);
    const entry = this.entries.get(path);
    return entry ? this.kindOfFragment(entry.body, path, seen) : `unknown`;
  }

  private kindOfFragment(xml: string, owner: string, seen: Set<string>): FactKind {
    const head = element(xml);
    if (!head) return `unknown`;

    // Two heads carry no type of their own and forward to one that does.
    if (head.tag === `Dependency`) {
      const target = attr(head.attrs, `path`);
      const resolved = target === null ? null : against(target, owner);
      return resolved === null ? `unknown` : this.kindOfPath(resolved, seen);
    }
    if (head.tag === `Switch`) {
      const then = element(head.inner, `Then`);
      return then ? this.kindOfFragment(then.inner, owner, seen) : `unknown`;
    }

    return TAG_KIND[head.tag] ?? `unknown`;
  }

  /** Where a fact is declared, for an error message. */
  describe(path: string): string {
    const resolved = this.resolve(path);
    if (resolved === null) {
      const cut = path.lastIndexOf(`/`);
      const owner = cut > 0 ? this.resolve(path.slice(0, cut)) : null;
      return owner === null ? `${path} (unresolvable)` : `${path} (${path.slice(cut + 1)} of ${owner})`;
    }
    const entry = this.entries.get(resolved)!;
    const head = element(entry.body);
    return `${path} → ${resolved} (<${head?.tag ?? `?`}> in ${entry.file})`;
  }
}
