# The transpiler

The Flow XML in `src/main/resources/direct-file/flow/`, and `facts/flowGates.xml` beside it, are
**generated**. Corrections go into the transpiler, never into the emitted XML, so the port stays
reproducible against an upstream that is still moving.

    make transpile          # regenerate the flow and its gate facts
    make transpile-verify   # check the page order against Direct File's 175 scenario snapshots

## Where it lives, and why that took a second try

All of it lives here, in this application. **The Direct File checkout is read-only**: nothing below
writes to it, and nothing of the transpiler lives inside it.

That is not free, because stage 1 has to import Direct File's own modules — its flow, its locale
helpers, its content shapes — and those are TSX resolved by that application's Vite config. The way
through is `vite-node --root <df-client-app>`: Vite's root is the Direct File checkout, so
`extract.ts` imports `/src/flow/flow.js` and gets the real thing, while the file doing the importing
sits over here. `make transpile` sets that up; `DF_CLIENT_APP` says where the checkout is.

Everything after stage 1 reads the JSON rather than the React app, so it runs under plain `node`,
which strips the types. That split is worth keeping for its own sake: the interesting stages are
testable without a DOM and reviewable as a diff.

## What is worth committing

`manifest.json` — yes. It is the record of what was mapped and what was dropped, and its diff is how
you notice that an upstream change silently removed twenty screens.

`flow-config.json` — 2 MB, and a judgement call. Committing it lets stages 2–5 run without a Direct
File checkout and makes an upstream sync show up as a reviewable diff of the input rather than only
of the output. Regenerating it is one command, so the argument against is only its size.

## Stage 1 — the flow, as JSON

    make transpile   # or, alone:
    npx --prefix $DF_CLIENT_APP vite-node --root $DF_CLIENT_APP codemod/extract.ts codemod/flow-config.json

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

`codemod/extract.ts` refuses to write output unless all four hold:

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
`flow.screens` is the order a taxpayer actually walks. `make transpile-verify` is the external
evidence, over the 175 recorded traversals in `flow-snapshots/`:

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

    make transpile   # or, alone:
    node codemod/emit.ts codemod/flow-config.json src/main/resources/direct-file

| Direct File | Becomes |
|---|---|
| `Category` (5) | nothing structural; Browse All groups by module, which is finer |
| `Subcategory` (25) | one flow module file, its pages in run order |
| run (218) | one `<page route="…">`, except for the 68 runs a collection absorbs |
| `Screen` (713) | one `<div class="df-screen" condition="/flowGateXXXXXXXX" operator="isTrue">`, in run order inside its page |
| `CollectionLoop` (19) | one `<fg-collection>` holding every screen of every page of that loop — see stage 7 |
| `isKnockout` screen (102) | `class="df-screen df-knockout"`, awaiting stage 4's `<fg-alert knockout="true">` |

The screen-as-conditional-div is the load-bearing choice: the flow runtime's
`showOrHideAllElements` deletes the facts of any `fg-set` it hides, which reproduces Direct File's
skip-and-clear semantics exactly. It also means page order and in-page order are the same
thing — the `<div>`s sit in the page in run order, so a screen the conditions reveal appears exactly
where Direct File would have navigated to it.

`group-by` is **not** used, contrary to an earlier draft of this file: it selects a splitting
strategy for single-question-per-screen mode (`h3` against per-question) and carries no grouping
into Browse All. Browse All groups by flow module, so the 25 subcategories are its sections.

### What 727 and 218 became

| | |
|---|---|
| screens emitted | 713 of 727 |
| pages emitted | 138 |
| runs absorbed into a collection | 68 of 218 |
| collections | 19, of which 8 are `readonly` |
| modules | 25 |

The 14 missing screens and the one missing page are the constant-folded ones below, listed
individually in `manifest.json` — 13 data-import screens whose condition is `data-import` with no
operator (so `isTrue`, so false here), and `create-new-self-select-pin`, whose condition is
`isEssarSigningPath`. The page `your-taxes/other-preferences/create-self-select-pin` had nothing
else on it. Nothing else is dropped, and a screen that vanishes for any other reason is a bug.

### Still placeholders after this stage

Every screen renders its route as an `<h2>` and its component list as a `<p>`; page titles are the
humanized route segment. Stage 4 replaces both. `manifest.json`'s `deferred` block names each one
and the stage that owes it, so nothing here is quietly permanent.

Collection loops were the one open *design* question here rather than a to-do. Stage 7 settled it.

## Stage 3 — conditions, as synthesized gate facts

Form Builder allows one condition per element and has seven operators. Direct File has eight, and
after gate flattening most screens carry an ANDed *list*. Rather than extend the condition parser,
the transpiler emits one derived fact per distinct condition set into `facts/flowGates.xml`, and the
flow references `condition="/flowGateXXXXXXXX"`. Every operator expands to `All`/`Any`/`Not`/
`IsComplete` over `Dependency`, all four of which are in fact-graph's `defaultFactories`.

**518 gates**, 330 at the root and 188 on a collection item; 57 are shared by more than one screen.
They are named by an 8-hex-digit hash of the normalized condition set — not a serial number, so an
unrelated change upstream does not renumber every gate below it — and identical sets collapse to
one fact.

`Condition.ts`'s `PathCondition.evaluate` is the specification:

| Direct File | Expansion |
|---|---|
| bare string, or `{condition}` with no operator | `<All><IsComplete/><Dependency/></All>` |
| `isTrue` | same |
| `isFalse` | `<All><IsComplete/><Not><Dependency/></Not></All>` |
| `isTrueOrIncomplete` | `<Any><Not><IsComplete/></Not><Dependency/></Any>` |
| `isFalseOrIncomplete` | `<Any><Not><IsComplete/></Not><Not><Dependency/></Not></Any>` |
| `isComplete` | `<IsComplete/>` |
| `isIncomplete` | `<Not><IsComplete/></Not>` |

`isTrueAndComplete` and `isFalseAndComplete` appear nowhere in the flattened screen conditions, so
neither needs an expansion.

**Every gate is total — Complete(true) or Complete(false), never Incomplete.** That is not a
property of the operators but of the order inside them: `AllOperator` short-circuits on the first
`Complete(false)`, so putting `<IsComplete>` first means the Incomplete dependency behind it is
never reduced. `AnyOperator` short-circuits on `Complete(true)` the same way, which is what makes
the two `…OrIncomplete` rows total. Totality is required rather than tidy — `checkCondition` reads
an Incomplete fact as false and would silently skip the screen.

**One approximation, stated.** Direct File's `isTrue` is `hasValue && !!get`, while
`isTrueAndComplete` is `complete && !!get`; the Fact Graph offers `IsComplete` and no `HasValue`, so
both map onto `complete`. The two differ only for a fact that has a value but is not complete — a
placeholder, or a derived fact with an incomplete dependency. Any parity failure that traces back
here is real and belongs in this table, not in a workaround.

### Conditions on facts that are not Boolean

`!!get` is JavaScript truthiness, so a Direct File condition may name a fact of any type. The Fact
Graph has no coercion — `<All>` rejects a non-Boolean child outright — so each one needs its
comparison written out. There is exactly one, `/claimedDependentsCount`, which expands to
`<GreaterThan>` against `<Int>0</Int>`; it is a `<Count>` and cannot be negative, so `> 0` and
`!= 0` agree. A new one upstream fails the Scala build with *"all children of `<All>` must be
BooleanNodes"*, which is what points back at the table in `gates.ts`.

### The conditions that are not facts

Far fewer than feared: `experimental` and `submissionBlockingFactsAreFalse` appear in **no** screen
condition at all.

| | Uses | Resolves to |
|---|---|---|
| `data-import` | 20 | its "not imported" branch — `isTrue` → false, `isFalse` → true, `isUnknown` → true |
| `isEssarSigningPath` | 1 | literal false |

### Scope

A gate is defined wherever its paths live: at `/theCollection/*/flowGateXXXXXXXX` when they carry
that collection's wildcard, at the root otherwise. Inside a collection-scoped gate the collection's
own paths are written relative (`../isImported`) and everything else stays absolute, which is what
lets one gate mix the two. `configureCollectionIds` rewrites `condition` along with `path` when it
clones a collection item, so the `<div>`'s `condition="/formW2s/*/flowGate7d13d8a7"` becomes
`/formW2s/#id/flowGate7d13d8a7` for that item — the same substitution the questions get.

Two facts about the data make this simple, and both are checked rather than assumed:

- **No screen's conditions span two collections.** A gate therefore has one scope or none.
- **Outside a loop, the only wildcard is `/filers/*`, and the screen's `collectionContext` is always
  `/primaryFiler` or `/secondaryFiler`** — 33 screens. Those are `<Find>` facts returning one filer,
  so the path is rewritten to `/primaryFiler/hasIpPin` and the gate sits at the root. The dictionary
  already reads through that alias in 106 places.

Either assumption breaking throws by name and route rather than producing a mis-scoped gate.

### The check that turns a stack trace into a sentence

A gate naming a fact the dictionary does not declare fails deep inside the Fact Graph's
initialisation, several frames from anything that says which flow condition caused it. So the
emitter reads every `<Fact path>` the application declares and refuses to write a gate that names
something else, reporting the path, the gate and the screen it came from. Its first run found four
— all a false alarm from reading only double-quoted `path="…"` attributes when `signing.xml` writes
some of its facts with single quotes, which is the kind of thing this check exists to make cheap to
find.

## Collection loops

Plan step 7, and the port's last open *design* question rather than a to-do. Direct File walks one collection item through many screens and returns to a hub to start the next.
`<fg-collection>` inverts that: it clones one block of markup per item, and every item is on one
page. So a loop's pages collapse into a single collection, and the only real question is *which*
page it lands on. The answer turns out not to be a matter of taste — it falls out of whether the
taxpayer can change the collection at all.

### Two kinds of loop, and the dictionary decides which

| | `autoIterate: false` (11) | `autoIterate: true` (8) |
|---|---|---|
| The collection is | `<Writable><Collection/></Writable>` | `<Derived><Filter …>` over another collection |
| Upstream renders | a hub screen: a list, an Add control, a Remove control | nothing of the kind — it walks the people another answer already put there |
| So the collection goes on | that hub's page | the loop's own first page |
| And is | editable | `readonly` |

The dictionary is the authority here, not a naming convention. `/form1099Gs` is
`<Writable><Collection/></Writable>` and the taxpayer types its rows in; `/cdccQualifyingPeople` is
`<Filter path="/familyAndHousehold">` and its membership is decided by an answer given three
sections earlier. An Add button on the second is not redundant, it is a crash: `addItem` writes the
collection fact, and a derived fact does not accept a write.

That is why stage 7 needed a library change rather than a transpiler trick.
`<fg-collection readonly="true">` renders no Add button and no per-item Remove, and the parser
refuses `determiner`, `disallow-empty`, `seed-item-if-true` and `add-item-if-true` beside it rather
than accepting an attribute that would move nothing. It landed in `~/form-builder` with a spec of
its own.

benefits-enrollment's `review.xml` names a neighbouring gap — "there is no built-in element for
'repeat this markup for each collection item, read-only'" — and `readonly` does **not** close it.
The fields inside a readonly collection are still inputs; what goes away is the Add button and the
Remove control. A read-only *display* of a collection is still missing, and that comment is still
accurate.

### Two facts about upstream, checked rather than assumed

Both of these are properties of Direct File that could stop holding, so `planLoops` fails by name
and route rather than guessing:

- **A loop's pages are one contiguous run.** If they were not, collapsing them would move the pages
  between them.
- **A manual loop's hub is the page immediately before its first loop page.** True for all eleven.
  The hub is found by its `CollectionItemManager`, not by position — position is then the assertion.

A third is asserted the other way round: an auto-iterating loop that grows a `CollectionItemManager`
fails too, because a derived collection with a hub means upstream changed something this reading
depends on.

### Reading a derived collection needs no special case

The gates inside a `readonly` collection name the *underlying* collection —
`/familyAndHousehold/*/flowGate7df6f8b9` inside `<fg-collection path="/cdccQualifyingPeople">` — and
that is correct rather than a leak. `Fact.applyWildcard` follows the derived `CollectionNode`'s
alias, so `getCollectionIds("/cdccQualifyingPeople")` returns the ids of the members that pass the
filter, and those ids *are* `/familyAndHousehold` ids. `configureCollectionIds` then rewrites every
attribute containing `/*/` regardless of which collection it names, so `/familyAndHousehold/*/x`
resolves against the right item. Verified against the engine before the design was committed to.

### The item's name comes from upstream's own Add button

`<fg-collection item-name>` needs a noun: the library composes "Add another **W-2**" and the item
heading "**W-2** #2" around it. Direct File already has the string — the hub's Add control is
`fields.{collection}.controls.add`, "Add W-2" — so stage 1 reads `en.yaml` and takes the noun out of
it. That gives `person`, `W-2`, `unemployment compensation`, `interest income`, `PFD`,
`care provider`, `Form 1099-SA`, `Form 1099-R`, `Social Security income` and `Form 1095-A`.

The eight `readonly` collections have no such key, and that is the same fact as everything above:
upstream never names those items, because it renders no list and no Add button over one. They fall
back to the humanized collection path (`cdcc qualifying people`) and are counted in
`manifest.json`'s `deferred` block as owing a real word.

### The collection inherits its hub's visibility

Every screen inside a collection carries its own flattened conditions, so hiding is already right.
The shell around them is not: a heading and an Add button would stand on a page Direct File would
have skipped. So the collection takes the hub screen's gate as its own `if-true`. Five of the eleven
hubs have one; the rest are unconditional, and get no attribute rather than a vacuous one.

## Stage 4 — content

The largest piece, and better supported than it looks. Keys are explicit (`i18nKey` on every content
component), the key contract is already computed by `src/locales/flowLocaleHelpers.ts`'s
`getExpected*Keys` functions, and the body-tree and named-link grammars have working
implementations in `packages/df-common`'s `contentGenerator.tsx` and `packages/df-i18n`'s
`CommonTranslation`. **Import those rather than reimplementing them** — they are what upstream's own
locale-parity tests run on, so a key this cannot find is a key upstream would also have flagged.

## Two checks on files the transpiler does not own

`locales/en.yaml` and `website-static/js/taxpert/direct-file-graph.js` are hand-written — the
transpiler owns `flow/` and `facts/flowGates.xml` and nothing else — but the flow decides what has
to be in both of them, and neither failure mode is visible without looking:

| The file says | Without a check |
|---|---|
| `all-screens.section.{module}` for each of the 25 flow modules | Browse All heads a section `all-screens.section.income-hsa` |
| the Outcome tracker's fact paths | a row that is blank forever, because the fact was renamed upstream |

So `make transpile` reads both and refuses to write, naming the module or the path. The section
headings are read out of the YAML as text rather than parsed: the block is four levels of plain
scalars this repo writes itself, and pulling in a YAML dependency for it would be the only one in
here.

## Stage 5 — a coverage manifest, not a silent pass

`codemod/manifest.json` is regenerated with every emit. It records the counts, every screen and page
dropped and why, every content component type met with the number of screens carrying it, and a
`deferred` block naming each construct stage 2 records rather than expresses and the stage that owes
it. An unhandled construct must never quietly vanish from 727 screens.

Today it is a report. Once stage 4 lands it gains teeth: an unmapped component type fails the run
unless it is on the out-of-scope allowlist, and the 51 types with their dispositions move into
`component-coverage.md` beside this file.
