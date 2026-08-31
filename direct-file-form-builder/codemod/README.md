# The transpiler

The Flow XML in `src/main/resources/direct-file/flow/`, and `facts/flowGates.xml` beside it, are
generated from [IRS Direct File](https://github.com/IRS-Public/direct-file)'s `df-client-app`.
Corrections go into the transpiler rather than into the emitted XML, so the port stays reproducible
against an upstream that is still moving.

```bash
make transpile          # regenerate the flow and its gate facts
make transpile-verify   # check page order, then gate parity, against Direct File
make export-scenarios   # regenerate scenarios/ from Direct File's backend fixtures
```

All three need a Direct File checkout. `DF_CLIENT_APP` says where it is, defaulting to
`../../direct-file/direct-file/df-client/df-client-app`. Nothing here writes to it.

## The files

| File | Stage | What it does |
|---|---|---|
| `extract.ts` | 1 | Runs Direct File's own flow compiler and writes `flow-config.json`. |
| `fact-types.ts` | 3 | Indexes `facts/*.xml` so a condition knows what type its fact holds. |
| `gates.ts` | 3 | Turns each distinct condition set into one derived Boolean fact. |
| `content.ts` | 4 | Resolves keys, body trees, links and modals into an intermediate representation. |
| `components.ts` | 4 | Maps each of the 51 Direct File content component types onto that representation. |
| `render.ts` | 4 | Prints the representation as Flow XML. |
| `emit.ts` | 2, 5 | Cuts pages, plans collection loops, writes the flow and the manifest. |
| `coverage.ts` | 5 | Renders `component-coverage.md`. |
| `verify-order.ts` | check | Page order against Direct File's 175 scenario snapshots. |
| `verify-visibility.ts` | check | Gate parity against 161 backend scenarios. |
| `scenario-graph.ts` | shared | Reads and translates the backend scenarios, for the two consumers below. |
| `export-scenarios.ts` | corpus | Writes `scenarios/` from those same graphs. |

## Where it runs

All of it lives here, in this application. Stage 1 has to import Direct File's own modules, its
flow, its locale helpers and its content shapes, and those are TSX resolved by that application's
Vite config. The way through is `vite-node --root <df-client-app>`. Vite's root is the Direct File
checkout, so `extract.ts` imports `/src/flow/flow.js` and gets the real thing while the file doing
the importing sits over here.

Everything after stage 1 reads the JSON rather than the React app, so it runs under plain `node`,
which strips the types. That split is worth keeping. The interesting stages are testable without a
DOM and reviewable as a diff.

`render.ts` and `emit.ts` import only types from `content.ts` and `components.ts`. A value import
across that line pulls `/src/locales/en.yaml` into a process that cannot resolve it.

## What is committed

`manifest.json` is the record of what was mapped and what was dropped. Its diff is how you notice
that an upstream change silently removed twenty screens.

`flow-config.json` is 2 MB and a judgement call. Committing it lets stages 2 to 5 run without a
Direct File checkout, and makes an upstream sync show up as a reviewable diff of the input rather
than only of the output. Regenerating it is one command, so the argument against it is only its size.

## Stage 1, the flow as JSON

```bash
npx --prefix $DF_CLIENT_APP vite-node --root $DF_CLIENT_APP codemod/extract.ts codemod/flow-config.json
```

`createFlowConfig(flowNodes)` is Direct File's own compiler. It walks the JSX in `flow.tsx` once and
returns a plain object graph with every ancestor `<Gate>` already flattened onto each screen as
`conditions`, each screen's `content` carrying its raw props, and its `setActions` extracted. Stage 1
therefore parses no JSX and walks no AST, and the gate flattening that the topic-page collapse
depends on arrives correct rather than reimplemented.

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
than written out, and fewer SubSubcategories because a route declared more than once resolves to one.

The category routes are `/flow/you-and-your-family`, `/flow/income`, `/flow/credits-and-deductions`,
`/flow/your-taxes` and `/flow/complete`. An early draft assumed a `/sign-and-submit` category, which
is in fact a subcategory of `complete`. The emitted routes drop the `/flow` prefix, since this
application is already served under `/app/direct-file`.

## Ordering

A question landing on the wrong page, or in the wrong place on the right page, is the failure this
port can least afford and would least easily notice. It is a checked invariant.

`flow.screens` is the only ordering source. `parseFlowRecursive` is a depth-first walk over
`Children.forEach`, and every container is built with `push`, so that array is exactly the order the
JSX declares.

The nested containers are not a safe substitute. "One page per SubSubcategory, screens in
`ssc.screens` order" is the obvious design and it is wrong in two measurable ways:

- `addSubSubcategory` early-returns on a `fullRoute` it has already seen, so a SubSubcategory
  declared in two places is merged into the first one. 14 of the 156 are, and their `screens` arrays
  are not contiguous in flow order. `spouse/spouse-basic-info` holds screens 60, 61 and 94. That page
  would have rendered screen 94 thirty-four screens early.
- 86 screens belong to no SubSubcategory at all, including intros, breathers and knockout landings. A
  per-SubSubcategory emit drops every one of them.

So pages are cut from runs of the global order. A run begins wherever the subcategory, the
SubSubcategory or the collection loop changes. That is the finest cut that never reorders a screen,
and the coarsest that never puts two unrelated headings on one page. 727 screens become 218 pages:
170 under a SubSubcategory, 48 under none, and 29 of them from the 14 split SubSubcategories.

`extract.ts` refuses to write output unless all four of these hold:

| Assertion | Catches |
|---|---|
| the pages concatenate back to `flow.screens` exactly | any reordering |
| every screen reaches exactly one page | a dropped or duplicated screen |
| every page is one contiguous run | a page whose own questions are out of sequence |
| no two pages share a route | a page silently overwriting another |

The route assertion fired on its first run, which is what it is for.
`/flow/income/hsa/hsa-intro` is both a screen route and a SubSubcategory route. Upstream keeps the
two in separate namespaces (`/flow/…` against `/data-view/…`) and this port collapses them into one.
Six routes collide that way. Routing is now collision-free by construction rather than by suffixing
afterwards. A SubSubcategory names its page only when it cut exactly one run and is not also a screen
route. Otherwise the run's first screen names it, screen routes being globally unique because
`addScreen` throws on a duplicate.

### Checked against the scenarios as well as the compiler

Those four assertions prove the extraction is faithful to `createFlowConfig`. They do not prove that
`flow.screens` is the order a taxpayer actually walks. `make transpile-verify` is the external
evidence, over the 175 recorded traversals in `flow-snapshots/`:

    scenarios          175
    navigation steps   25733
    loop re-entries    257   (expected: a loop starting its next item)
    unknown routes     0
    violations         0

Every screen any scenario visits is one the extraction has, and every backward step is a collection
loop starting its next item. There are no others. So outside collection loops, the flow's declaration
order is its navigation order, which is what makes cutting pages from runs of it safe. If upstream
ever adds a genuine jump, this fails rather than producing a flow whose questions are subtly out of
order.

## Stage 2, structure

```bash
node codemod/emit.ts codemod/flow-config.json src/main/resources/direct-file
```

| Direct File | Becomes |
|---|---|
| `Category` (5) | nothing structural. Browse All groups by module, which is finer. |
| `Subcategory` (25) | one flow module file, its pages in run order |
| run (218) | one `<page route="…">`, except for the 68 runs a collection absorbs |
| `Screen` (713) | one `<div class="df-screen" condition="/flowGateXXXXXXXX" operator="isTrue">`, in run order inside its page |
| `CollectionLoop` (19) | one `<fg-collection>` holding every screen of every page of that loop |
| `isKnockout` screen (102) | `class="df-screen df-knockout"`, with stage 4's `<fg-alert knockout="true">` inside |

The screen-as-conditional-div is the load-bearing choice. The flow runtime's
`showOrHideAllElements` deletes the facts of any `fg-set` it hides, which reproduces Direct File's
skip-and-clear semantics exactly. It also means page order and in-page order are the same thing. The
`<div>`s sit in the page in run order, so a screen the conditions reveal appears exactly where Direct
File would have navigated to it.

It is also what `--singleQuestionPerScreen` cuts along. That div carries the screen's condition in
its own attributes, so `PageSplitter` cannot flatten it away, and it cuts between the divs instead.
See the app README.

`group-by` is not used, contrary to an earlier draft of this file. It selects a splitting strategy
for single-question-per-screen mode (`h3` against per-question) and carries no grouping into Browse
All. Browse All groups by flow module, so the 25 subcategories are its sections.

### What 727 and 218 became

| | |
|---|---|
| screens emitted | 713 of 727 |
| pages emitted | 138 |
| runs absorbed into a collection | 68 of 218 |
| collections | 19, of which 8 are `readonly` |
| modules | 25 |

The 14 missing screens and the one missing page are constant-folded, and listed individually in
`manifest.json`. Thirteen are data-import screens whose condition is `data-import` with no operator,
so `isTrue`, so false here. The fourteenth is `create-new-self-select-pin`, whose condition is
`isEssarSigningPath`. The page `your-taxes/other-preferences/create-self-select-pin` had nothing else
on it. Nothing else is dropped, and a screen that vanishes for any other reason is a bug.

## Stage 3, conditions as synthesized gate facts

Form Builder allows one condition per element and has seven operators. Direct File has eight, and
after gate flattening most screens carry an ANDed list. Rather than extend the condition parser, the
transpiler emits one derived fact per distinct condition set into `facts/flowGates.xml`, and the flow
references `condition="/flowGateXXXXXXXX"`. Every operator expands to `All`, `Any`, `Not` and
`IsComplete` over `Dependency`, all four of which are in fact-graph's `defaultFactories`.

798 gates, 533 at the root and 265 on a collection item. 211 are shared by more than one screen. They
are named by an 8-hex-digit hash of the normalized condition set rather than by a serial number, so
an unrelated change upstream does not renumber every gate below it, and identical sets collapse to
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

Every gate is total, meaning Complete(true) or Complete(false) and never Incomplete. That is a
property of the order inside the operators rather than of the operators themselves. `AllOperator`
short-circuits on the first `Complete(false)`, so putting `<IsComplete>` first means the Incomplete
dependency behind it is never reduced. `AnyOperator` short-circuits on `Complete(true)` the same way,
which is what makes the two `…OrIncomplete` rows total. Totality is required rather than tidy,
because `checkCondition` reads an Incomplete fact as false and would silently skip the screen.

One approximation is worth stating. Direct File's `isTrue` is `hasValue && !!get`, while
`isTrueAndComplete` is `complete && !!get`. The Fact Graph offers `IsComplete` and no `HasValue`, so
both map onto `complete`. The two differ only for a fact that has a value but is not complete, which
means a placeholder or a derived fact with an incomplete dependency. Any parity failure that traces
back here is real and belongs in this table rather than in a workaround.

### Conditions on facts that are not Boolean

`!!get` is JavaScript truthiness, so a Direct File condition may name a fact of any type. The Fact
Graph has no coercion. `<All>` rejects a non-Boolean child outright, from inside
`All.fromDerivedConfig` with nothing in the message naming the gate, so each one needs its comparison
written out. Of the 618 distinct condition paths, 605 are Boolean, 12 resolve to an object and 1 is
an `Int`.

The type comes out of the dictionary rather than out of a hand-maintained table. `fact-types.ts`
indexes every `<Fact path>` in `facts/*.xml`, classifies it by its head element, and follows the two
heads that only forward: `<Dependency>`, and `<Switch>` through its first `<Then>`. It also resolves
the paths that are not declared verbatim, which is most of them. `/primaryFiler/hasIpPin` reads
through a `<Find>` over `/filers` to `/filers/*/hasIpPin`, `/formW2s/*/filer/isPrimaryFiler` through
a `<CollectionItem collection="/filers">`, `/firstHohQP/isClaimedDependent` through an `<IndexOf>`,
and `/primaryFiler/tin/isSSN` through a member the engine's `TinNode` synthesizes rather than a fact
at all.

| Kind | Truthiness test | Why |
|---|---|---|
| `boolean` | the dependency itself | |
| `int` | `<NotEqual>` against `<Int>0</Int>` | a bare JS number, so `0` is falsy. Sign included, so no assumption about the fact's range. |
| `object` | `<IsComplete>` alone | a `Dollar`, `Day`, `Enum` or collection item crosses into JavaScript as an opaque Scala object, and an object is always truthy, so upstream's `!!get` on one means "has a value" |
| `string`, `numeric` | throws | see below |

The `object` row looks like a shortcut and is not. `interest.xml`'s five bond-premium accordions are
conditioned on Dollar facts that default to `<Dollar>0</Dollar>`, and upstream they show whenever the
1099-INT is complete, because `!!` of a Scala object is `true`, zero included. The expansion
reproduces that rather than the "is it nonzero" the condition looks like it wants. It also collapses
to the `<IsComplete>` the expansion already emits for totality, so those gates are one element rather
than an `<All>` of the same thing twice.

`string` and `numeric` throw rather than guess. A JS string is falsy when empty and there is no
length CompNode to say that with. `<Add>` is an `Int` over Ints and a `Dollar` over Dollars, and
picking the wrong one turns a zero total into `true` silently. Neither is reachable from any
condition today, and if one becomes reachable the answer is a line in `gates.ts`'s `TRUTHINESS`
rather than a default.

### The conditions that are not facts

Far fewer than feared. `experimental` and `submissionBlockingFactsAreFalse` appear in no screen
condition at all.

| | Uses | Resolves to |
|---|---|---|
| `data-import` | 20 | its "not imported" branch: `isTrue` to false, `isFalse` to true, `isUnknown` to true |
| `isEssarSigningPath` | 1 | literal false |

### Scope

A gate is defined wherever its paths live: at `/theCollection/*/flowGateXXXXXXXX` when they carry
that collection's wildcard, and at the root otherwise. Inside a collection-scoped gate the
collection's own paths are written relative (`../isImported`) and everything else stays absolute,
which is what lets one gate mix the two. `configureCollectionIds` rewrites `condition` along with
`path` when it clones a collection item, so the div's `condition="/formW2s/*/flowGate7d13d8a7"`
becomes `/formW2s/#id/flowGate7d13d8a7` for that item, the same substitution the questions get.

Two facts about the data make this simple, and both are checked rather than assumed:

- No screen's conditions span two collections, so a gate has one scope or none.
- Outside a loop the only wildcard is `/filers/*`, and the screen's `collectionContext` is always
  `/primaryFiler` or `/secondaryFiler`, on 33 screens. Those are `<Find>` facts returning one filer,
  so the path is rewritten to `/primaryFiler/hasIpPin` and the gate sits at the root. The dictionary
  already reads through that alias in 106 places.

Either assumption breaking throws by name and route rather than producing a mis-scoped gate.

### The check that turns a stack trace into a sentence

A gate naming a fact the dictionary does not declare fails deep inside the Fact Graph's
initialisation, several frames from anything that says which flow condition caused it. So the emitter
reads every `<Fact path>` the application declares and refuses to write a gate that names something
else, reporting the path, the gate and the screen it came from. Its first run found four, all a false
alarm from reading only double-quoted `path="…"` attributes when `signing.xml` writes some of its
facts with single quotes. That is the kind of thing this check exists to make cheap to find.

## Collection loops

Direct File walks one collection item through many screens and returns to a hub to start the next.
`<fg-collection>` inverts that: it clones one block of markup per item, and every item is on one
page. So a loop's pages collapse into a single collection, and the remaining question is which page
it lands on. The answer falls out of whether the taxpayer can change the collection at all.

### Two kinds of loop, and the dictionary decides which

| | `autoIterate: false` (11) | `autoIterate: true` (8) |
|---|---|---|
| The collection is | `<Writable><Collection/></Writable>` | `<Derived><Filter …>` over another collection |
| Upstream renders | a hub screen: a list, an Add control, a Remove control | nothing of the kind. It walks the people another answer already put there. |
| So the collection goes on | that hub's page | the loop's own first page |
| And is | editable | `readonly` |

The dictionary is the authority here rather than a naming convention. `/form1099Gs` is
`<Writable><Collection/></Writable>` and the taxpayer types its rows in. `/cdccQualifyingPeople` is
`<Filter path="/familyAndHousehold">` and its membership is decided by an answer given three sections
earlier. An Add button on the second is a crash rather than a redundancy: `addItem` writes the
collection fact, and a derived fact does not accept a write.

That is why this needed a library change rather than a transpiler trick.
`<fg-collection readonly="true">` renders no Add button and no per-item Remove, and the parser
refuses `determiner`, `disallow-empty`, `seed-item-if-true` and `add-item-if-true` beside it rather
than accepting an attribute that would move nothing.

benefits-enrollment's `review.xml` names a neighbouring gap, that there is no built-in element for
"repeat this markup for each collection item, read-only", and `readonly` does not close it. The
fields inside a readonly collection are still inputs. What goes away is the Add button and the Remove
control. A read-only display of a collection is still missing, and that comment is still accurate.

### Two facts about upstream, checked rather than assumed

Both are properties of Direct File that could stop holding, so `planLoops` fails by name and route
rather than guessing:

- A loop's pages are one contiguous run. If they were not, collapsing them would move the pages
  between them.
- A manual loop's hub is the page immediately before its first loop page. True for all eleven. The
  hub is found by its `CollectionItemManager`, and position is then the assertion.

A third is asserted the other way round. An auto-iterating loop that grows a `CollectionItemManager`
fails too, because a derived collection with a hub means upstream changed something this reading
depends on.

### Reading a derived collection needs no special case

The gates inside a `readonly` collection name the underlying collection, so
`/familyAndHousehold/*/flowGate7df6f8b9` appears inside
`<fg-collection path="/cdccQualifyingPeople">`. That is correct rather than a leak.
`Fact.applyWildcard` follows the derived `CollectionNode`'s alias, so
`getCollectionIds("/cdccQualifyingPeople")` returns the ids of the members that pass the filter, and
those ids are `/familyAndHousehold` ids. `configureCollectionIds` then rewrites every attribute
containing `/*/` regardless of which collection it names, so `/familyAndHousehold/*/x` resolves
against the right item. This was verified against the engine before the design was committed to.

### The item's name

`<fg-collection item-name>` needs a noun. The library composes "Add another W-2" and the item heading
"W-2 #2" around it.

For the eleven manual loops Direct File already has the string. The hub's Add control is
`fields.{collection}.controls.add`, "Add W-2", so stage 1 reads `en.yaml` and takes the noun out of
it. That gives `person`, `W-2`, `unemployment compensation`, `interest income`, `PFD`,
`care provider`, `Form 1099-SA`, `Form 1099-R`, `Social Security income` and `Form 1095-A`.

The eight `readonly` collections have no such key, because upstream renders no list and no Add button
over one. This port does render a heading per item, so the word has to come from somewhere.
`AUTO_ITERATED_ITEM_NAMES` in `extract.ts` names those eight (`person`, `qualifying person`,
`qualifying child`), and the table is the record of the choice. A collection that neither source
names falls back to the humanized collection path and is counted in `manifest.json` as
`collectionsWithNoItemName`, which should stay 0.

### The collection inherits its hub's visibility

Every screen inside a collection carries its own flattened conditions, so hiding is already right.
The shell around them is not. A heading and an Add button would stand on a page Direct File would
have skipped, so the collection takes the hub screen's gate as its own `if-true`. Five of the eleven
hubs have one. The rest are unconditional and get no attribute rather than a vacuous one.

## Stage 4, content

The largest piece, and better supported than it looks. Keys are explicit, with an `i18nKey` on every
content component, and the body-tree and named-link grammars have working implementations in
`packages/df-common`'s `contentGenerator.tsx` and `packages/df-i18n`'s `CommonTranslation`. Those are
imported rather than reimplemented, because they are what upstream's own locale-parity tests run on,
so a key this cannot find is a key upstream would also have flagged. It finds all of them: 0 missing
keys over 4,346 content declarations.

### How the words are got at

`generateContent` builds React elements and this never renders them. Walking the un-rendered tree
gives the tag structure and the resolved subkeys together, which is what makes a body tree,
`{ p: …, ul: { li: … } }` under one key, come out as blocks rather than as one flattened string.

Two things had to be read out of upstream's own components rather than guessed at. Modal ids come
from the tags in the launcher text, the way `DFModal.tsx`'s `extractTags` reads them, which is how a
`sharedModalX`, referenced from a screen and defined once under the top-level `modals:`, is found at
all. And `SummaryTable`'s rows are `{th, td}` pairs, `DFAlert`'s body is `alertText` with its heading
at `alertText.heading`, and `iconLists` are flat line maps rather than body trees. Each of those is
`SummaryTable.tsx`, `getKeyValues` and `IconList.tsx` read and followed.

### What the representation holds, and what it drops

Two counts come out of the same walk and mean opposite things, which is why
`component-coverage.md` keeps them in separate tables.

**Constructs with no shape in the IR** is a gap. The words survive, the structure does not, and the
count is the argument for adding a node. It is 0. Four changes closed it:

- **Nested lists.** A `<li>` carries blocks as well as a line (`ListItem` in `content.ts`), so Direct
  File's two-level lists stay two-level. 44 items used to arrive as one flat run of sentences.
  form-builder needs no change for this, because it parses `<li>` as a leaf and re-emits the inner
  markup verbatim, so the nested list reaches the page. The cost is that the nested items share their
  parent item's translation key rather than getting their own.
- **A bare run of `<li>`s.** `- ul: $t(key)` puts the whole list body behind a reference, so expanding
  it hands the block splitter list items with no list around them. `wrapBareListItems` wraps them,
  and only when they are not already inside a `<ul>`.
- **`<InternalLink>` where a route exists.** The route is a component prop rather than a url in the
  locale file: `ConditionalList`'s per-item `editRoute`, and `DFAlert`'s and `DFAccordion`'s
  `internalLink`. It is threaded in as an inherited url, and `blocksForBody` grew the parameter that
  lets an alert's body see it.
- **Option labels**, below.

**Markup dropped on purpose** is a decision, and each row in that table carries its reason: a
`/data-view/…` link this port has no page for, a tag upstream binds no component to either, a PDF
button, a `<span>`.

### The option labels were a defect

70 enum and multi-enum option labels used to be flattened to plain text, on the grounds that an
`<option>` carries a string. 55 of them held a `{{/fact}}` reference, and `plainText` renders a fact
node as the empty string. "I lived in more than 1 state in {{/taxYear}}" reached the page with the
year missing, and an option whose whole label was `{{/taxYear}}` reached it blank.

The fix needed one word in the library. `FgSet.scala` already stores an option's inner markup as its
translation value, and form-builder's `enum.html` and `multi-enum.html` escaped it on the way out.
They now use `th:utext`, the way the boolean input's options always have, and this application's
`FlowConfig.rng` says `<option>` may hold inline content. `select` still flattens, because an HTML
`<option>` holds text and nothing else, and none of Direct File's select options needs more, so that
count is 0 too.

### Ids, and one Markdown-shaped constraint on them

A modal's id is `modal-` plus the key that owns it plus the tag, capped at 96 characters with a hash
of the whole when it does not fit. The cap is not cosmetic. Every id becomes a mapping key in the
generated `flow_en.yaml`, and past 128 characters the YAML printer switches to the explicit-key form
(`? key` on its own line, then `: value`) which the parser that reads the file back rejects. The
build writes a file it cannot load, and the error surfaces on the next run pointing at a line that
looks fine. Four of Direct File's `/info/credits-and-deductions/credits/eitc/...` keys are that long.
form-builder now fails on an over-long key by name, so this is belt as well as braces.

### Page titles

A page's title is Direct File's own sub-subcategory label, the words its side nav uses, for the 155
pages that have one, and the first screen's heading for the 48 that do not. 25 of those labels
interpolate a fact (`{{/familyAndHousehold/*/firstName}}'s basic information`), and a Form Builder
page title is a static attribute on `<page>`, so the interpolation is dropped and what is left is
tidied and capitalised: "Basic information". That is a real difference from upstream, where the nav
says the person's name.

Fourteen sub-subcategories were cut into two pages each, because their screens are not contiguous in
the flow, and both halves take the same label. That is also what upstream's nav shows.

## What the emitted flow needed the grammar to allow

`flow/FlowConfig.rng` is app-owned, as it is in every application here, so it is widened rather than
worked around. Each widening is Direct File writing something the seed grammar had not met.

| Widened | Because |
|---|---|
| seven scalar `<input type>` values, and `collection-item-reference` with its `item-label` | the eight input types `Main.scala` registers |
| an enum or multi-enum `<option>` takes inline content | 55 option labels interpolate a fact, and 19 bold part of themselves |
| `<li>` may contain a nested `<ul>` or `<ol>` | Direct File authors two-level lists, 44 of them |
| `<fg-alert>` needs no body | many Direct File alerts are a heading and nothing else |
| an alert body may contain `<fg-detail>` | an accordion inside an alert |
| `<p>` inside an alert body takes the `condition`/`operator` pair | an alert paragraph shown only under a condition |
| `<ol>` takes that pair, as `<ul>` already did | a numbered list shown only under a condition |
| `<br/>` | Direct File's content uses it 161 times |
| `<fg-apply>` | form-builder parses it, and no application here had used one before |

The body-less `<fg-alert>` is a form-builder change as well as a grammar one. Its parser rejected an
element with no children to parse, which for `<fg-alert>` is a complete alert. It now passes
`required = false`, and form-builder's own seed grammar says `zeroOrMore` too.

## The parity gate

`make transpile-verify` runs two checks, and between them they are the port's whole claim. The first
is the ordering one above. The second, `verify-visibility.ts`, asks whether a screen shows for
exactly the taxpayers it shows for upstream.

    scenarios              161
    screen/item decisions  89329
    agreements             88428
    known differences      901  (7 screens, see KNOWN in this file)
    unexpected             0

For each of the backend's 161 scenarios it builds the fact graph the way upstream's own snapshot test
does, using `setupFactGraph` with the same seeding of `/filers`, `/email` and the primary filer's
TIN. It loads that same state into a graph over this application's dictionary, and then, for every
screen at every item of its collection, asks both sides: does `screen.conditions.every(evaluate)`
pass, and is the gate fact true?

This runs in-engine rather than through a browser. The plan called for Playwright over the generated
pages. This answers the same question through four fewer layers, each of which has its own reasons to
differ. What is being checked is stage 3's claim, that a synthesized Boolean fact says what an ANDed
list of Direct File conditions says, and both sides of that are functions of a fact graph. The
browser-level check is `make smoke`, which covers a different class of failure.

`isAvailable` is deliberately not reused. It is `conditions` and "an auto-iterating loop has
members", and the second half is `<fg-collection>`'s job here rather than the gate's. A loop over an
empty collection renders no items, so no screen inside it exists to be hidden.

### The 7 screens that differ

Six are the one approximation stage 3 documents, seen from the other end. Direct File's `isTrue` is
`fact.hasValue && !!fact.get`, and `hasValue` is true for a placeholder, meaning a value the
dictionary supplies until the taxpayer answers. The Fact Graph has `IsComplete`, which is false for
one, and no `HasValue` CompNode at all. So a screen gated on a fact that currently holds its
placeholder shows upstream and hides here. All six are exactly that shape, four of them on the W-2
loop.

Closing it means adding a `HasValue` CompNode to `fact-graph`, where `Result.hasValue` already
exists, and re-deciding how `<All>` short-circuits over a placeholder, which is what currently makes
these gates total. That is a change to the gate scheme rather than a patch, and it has deliberately
not been made from here.

The seventh is `create-new-self-select-pin`, gated on `isEssarSigningPath`, which is a build flag
rather than a fact. This port has no e-signature path, so it folds to its "off" branch and the screen
is not emitted at all.

`KNOWN` in `verify-visibility.ts` lists all seven with their reasons, and the check fails on anything
else. It also fails on a screen in `KNOWN` that has come back into line, so a stale entry cannot hide
a later regression.

### One engine defect it found

A fact graph holding a `Pin` or an `IpPin` could not be deserialized. `Pin.apply(String)` called
`parseString`, which called `Pin.apply(String)`, and the derived `ReadWriter` constructs through
`apply`. Construction went through `new` everywhere in the engine and never noticed. In an
application it means answering the self-select PIN or an IP PIN and reloading the page. Fixed in
`fact-graph` with a round-trip test on both types.

## Two checks on files the transpiler does not own

The transpiler owns `flow/` and `facts/flowGates.xml` and nothing else. `locales/en.yaml` and
`website-static/js/taxpert/direct-file-graph.js` are hand-written, but the flow decides what has to
be in both of them, and neither failure mode is visible without looking.

| The file says | Without a check |
|---|---|
| `all-screens.section.{module}` for each of the 25 flow modules | Browse All heads a section `all-screens.section.income-hsa`, and so does the step indicator |
| the Outcome tracker's fact paths | a row that is blank forever, because the fact was renamed upstream |

So `make transpile` reads both and refuses to write, naming the module or the path. The section
headings are read out of the YAML as text rather than parsed. The block is four levels of plain
scalars this repository writes itself, and pulling in a YAML dependency for it would be the only one
in here.

## Stage 5, the coverage report

Two files, regenerated with every emit.

`manifest.json` records the counts, every screen and page dropped with the reason, every content
component type met with the number of declarations carrying it, and a `deferred` block naming each
construct a stage records rather than expresses. Its diff is how you notice that an upstream change
silently removed twenty screens.

`component-coverage.md` is the readable half: all 51 component types Direct File's flow declares,
grouped into expressed, drawn by something else, out of scope, and real gaps, with what each becomes
and how many declarations took that route. A type can appear twice. `Address` has 8 real questions
and 1 marked `displayOnlyOn: 'data-view'`, because the dispositions are counted per declaration
rather than overwritten per type. Recording only the last one had said the address input was never
rendered, which is the kind of claim a coverage file must not make.

It is generated by `coverage.ts`. Edit that rather than the Markdown.

The pass is enforced in code rather than by the file. `ComponentMapper.blocks` throws on a component
type that is in none of its tables, naming the type and the screen, and the emit fails. So every row
in `component-coverage.md` is a decision that exists in `components.ts`, and an unhandled construct
cannot quietly vanish from 727 screens. Adding a type upstream means adding it to one of
`RENDERED_ELSEWHERE`, `OUT_OF_SCOPE`, `NOT_EXPRESSIBLE`, `INPUT_TYPES` or the `switch`, and the build
says which.

`NOT_EXPRESSIBLE` is now empty. Its one entry was `CollectionItemReference`, 13 declarations of a
fact whose value is a collection item, which no `<input type>` wrote, so the question rendered and
could not be answered. The application grew one: `<input type="collection-item-reference"
item-label="…"/>`, a radio per item of the referenced collection. Only the label travels in the flow,
because it is authored prose evaluated once per item. Which collection to list is read out of the
fact dictionary by `inputs/CollectionItemReference.scala`, so the flow cannot disagree with it.

The table is kept rather than deleted. It is where a newly-met component goes while it is still a
gap, and an empty "Real gaps" section in `component-coverage.md` is a claim worth being able to make.
