# The transpiler

The Flow XML in `src/main/resources/direct-file/flow/` is **generated**. Corrections go into the
transpiler, never into the emitted XML, so the port stays reproducible against an upstream that is
still moving.

The transpiler runs **inside `direct-file/df-client/df-client-app`**, under `vite-node`, because it
needs to import that app's own modules — its flow, its locale helpers, its content shapes. That is
an established pattern there; eight of its npm scripts already work that way. This directory holds
the contract, not the code.

## Stage 1 — the flow, as JSON

    cd direct-file/df-client/df-client-app
    npm run to-form-builder:extract -- /tmp/flow-config.json

`createFlowConfig(flowNodes)` is Direct File's own compiler. It walks the JSX in `flow.tsx` once and
returns a plain object graph with **every ancestor `<Gate>` already flattened onto each screen** as
`conditions`, each screen's `content` carrying its raw props, and its `setActions` extracted. So
stage 1 parses no JSX and walks no AST — and the gate flattening the topic-page collapse depends on
arrives correct rather than reimplemented.

Everything after this reads the JSON, not the React app.

### What is in there

| | Count |
|---|---|
| Categories | 5 |
| Subcategories | 25 |
| SubSubcategories | 156 (87 top-level, 69 inside collection loops) |
| Collection loops | 19 |
| Screens | 727 |
| Knockout screens | 102 |
| Distinct content component types | 51 |

These correct the numbers taken by grepping `flow-chunks/`, which counted 185 SubSubcategories, 17
loops and 704 screens. There are more screens and loops than tags because some are generated rather
than written out, and fewer SubSubcategories because a route declared more than once resolves to
one.

The category routes are `/flow/you-and-your-family`, `/flow/income`,
`/flow/credits-and-deductions`, `/flow/your-taxes` and **`/flow/complete`** — not the
`/sign-and-submit` an early draft assumed; that is a subcategory of `complete`. The emitted routes
drop the `/flow` prefix, since this application is already served under `/app/direct-file`.

## Ordering — the thing that must not go wrong

A question landing on the wrong page, or in the wrong place on the right page, is the failure this
port can least afford and would least easily notice. It is a checked invariant, not a hope.

**`flow.screens` is the only ordering source.** `parseFlowRecursive` is a depth-first walk over
`Children.forEach`, and every container is built with `push`, so that array is exactly the order the
JSX declares.

**The nested containers are not a safe substitute.** "One page per SubSubcategory, screens in
`ssc.screens` order" is the obvious design and it is wrong twice, measurably:

- `addSubSubcategory` early-returns on a `fullRoute` it has already seen, so a SubSubcategory
  declared in two places is merged into the first one. **14 of the 156 are**, and their `screens`
  arrays are not contiguous in flow order — `spouse/spouse-basic-info` holds screens 60, 61 and
  **94**. That page would have rendered screen 94 thirty-four screens early.
- **86 screens belong to no SubSubcategory at all** — intros, breathers, knockout landings. A
  per-SubSubcategory emit drops every one of them.

**So pages are cut from runs of the global order.** A run begins wherever the subcategory, the
SubSubcategory or the collection loop changes: the finest cut that never reorders a screen, and the
coarsest that never puts two unrelated headings on one page. 727 screens become **218 pages** — 170
under a SubSubcategory, 48 under none, 29 of them from the 14 split SubSubcategories.

`extract.ts` refuses to write output unless all four hold:

| Assertion | Catches |
|---|---|
| the pages concatenate back to `flow.screens` exactly | any reordering |
| every screen reaches exactly one page | a dropped or duplicated screen |
| every page is one contiguous run | a page whose own questions are out of sequence |
| no two pages share a route | a page silently overwriting another |

The route assertion fired on its first run, which is what it is for.
`/flow/income/hsa/hsa-intro` is both a screen route and a SubSubcategory route — upstream keeps the
two in separate namespaces (`/flow/…` against `/data-view/…`) and this port collapses them into one.
Six routes collide that way. Routing is now collision-free by construction rather than by suffixing
afterwards: a SubSubcategory names its page only when it cut exactly one run *and* is not also a
screen route; otherwise the run's first screen names it, screen routes being globally unique because
`addScreen` throws on a duplicate.

### Verified against the scenarios, not just against the compiler

Those four assertions prove the extraction is faithful to `createFlowConfig`. They do not prove that
`flow.screens` is the order a taxpayer actually walks. `npm run to-form-builder:verify-order` is the
external evidence, over the 175 recorded traversals in `flow-snapshots/`:

    scenarios          175
    navigation steps   25733
    loop re-entries    257   (expected: a loop starting its next item)
    unknown routes     0
    violations         0

Every screen any scenario visits is one the extraction has, and **every** backward step is a
collection loop starting its next item. There are no others. So outside collection loops, the flow's
declaration order *is* its navigation order — which is precisely what makes cutting pages from runs
of it safe. If upstream ever adds a genuine jump, this fails rather than producing a flow whose
questions are subtly out of order.

## Stage 2 — structure

| Direct File | Becomes |
|---|---|
| `Category` (5) | nothing structural; carried as `group-by` and as the Browse All grouping |
| `Subcategory` (25) | one flow module file, its pages in run order |
| run (218) | one `<page route="…" group-by="…">` |
| `Screen` (727) | one `<div condition="/flowGateNNN" operator="isTrue">`, in run order inside its page |
| `CollectionLoop` (19) | one `<fg-collection>` page; its inner SubSubcategories collapse into it |
| `isKnockout` screen (102) | `<fg-alert knockout="true" if-true="/flowGateNNN">` |

The screen-as-conditional-div is the load-bearing choice: the flow runtime's
`showOrHideAllElements` deletes the facts of any `fg-set` it hides, which reproduces Direct File's
skip-and-clear semantics exactly. It also means page order and in-page order are the same
thing — the `<div>`s sit in the page in run order, so a screen the conditions reveal appears exactly
where Direct File would have navigated to it.

## Stage 3 — conditions, as synthesized gate facts

Form Builder allows one condition per element and has seven operators. Direct File has eight, and
after gate flattening most screens carry an ANDed *list*. Rather than extend the condition parser,
the transpiler emits one derived fact per distinct condition set into `facts/flowGates.xml`, and the
flow references `if-true="/flowGateNNN"`. Every operator expands to `All`/`Any`/`Not`/`IsComplete`
over `Dependency`, all four of which are in fact-graph's `defaultFactories`. The result is total —
never `Incomplete` — which is what `if-true` needs.

`Condition.ts`'s `PathCondition.evaluate` is the specification:

| Direct File | Expansion | Uses |
|---|---|---|
| bare string, or `{condition}` with no operator | `<All><IsComplete/><Dependency/></All>` | 2,210 |
| `isTrue` | same | 11 |
| `isFalse` | `<All><IsComplete/><Not><Dependency/></Not></All>` | 342 |
| `isTrueOrIncomplete` | `<Any><Not><IsComplete/></Not><Dependency/></Any>` | 158 |
| `isFalseOrIncomplete` | `<Any><Not><IsComplete/></Not><Not><Dependency/></Not></Any>` | 65 |
| `isComplete` | `<IsComplete/>` | 13 |
| `isIncomplete` | `<Not><IsComplete/></Not>` | 7 |

`isTrueAndComplete` and `isFalseAndComplete` appear nowhere in the flattened screen conditions, so
neither needs an expansion.

**One approximation, stated.** Direct File's `isTrue` is `hasValue && !!get`, while
`isTrueAndComplete` is `complete && !!get`; the Fact Graph offers `IsComplete` and no `HasValue`, so
both map onto `complete`. The two differ only for a fact that has a value but is not complete — a
placeholder, or a derived fact with an incomplete dependency. Any parity failure that traces back
here is real and belongs in this table, not in a workaround.

### The conditions that are not facts

Far fewer than feared: `experimental` and `submissionBlockingFactsAreFalse` appear in **no** screen
condition at all.

| | Uses | Resolves to |
|---|---|---|
| `data-import` | 20 | its "not imported" branch — `isTrue` → false, `isFalse` → true, `isUnknown` → true |
| `isEssarSigningPath` | 1 | literal false |

### Scope

A gate whose paths all sit under one collection is defined at `/theCollection/*/flowGateNNN` rather
than at the root; absolute dependencies resolve fine from inside a collection item, so a
mixed-scope gate lives at the collection scope. Gates are named by a hash of the normalized
condition set — `rawConditionToString` gives a canonical string per condition — so identical sets
collapse to one fact and regeneration is stable.

## Stage 4 — content

The largest piece, and better supported than it looks. Keys are explicit (`i18nKey` on every content
component), the key contract is already computed by `src/locales/flowLocaleHelpers.ts`'s
`getExpected*Keys` functions, and the body-tree and named-link grammars have working
implementations in `packages/df-common`'s `contentGenerator.tsx` and `packages/df-i18n`'s
`CommonTranslation`. **Import those rather than reimplementing them** — they are what upstream's own
locale-parity tests run on, so a key this cannot find is a key upstream would also have flagged.

## Stage 5 — a coverage manifest, not a silent pass

Every stage records the component types it met, how each was mapped, and every one that fell
through. An unmapped type fails the run unless it is on the out-of-scope allowlist. This is what
keeps iteration honest: an unhandled construct must never quietly vanish from 727 screens.

The 51 types, and where each stands, live in `component-coverage.md` beside this file once stage 4
lands.
