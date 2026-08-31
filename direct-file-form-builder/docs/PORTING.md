# Porting Direct File onto Form Builder

This application is a port of the questionnaire in
[IRS Direct File](https://github.com/IRS-Public/direct-file)'s `df-client-app` onto
`gov.irs::form-builder`, with the `taxpert` workspace over it. Auth, MeF submission, PDF
generation, data import, the state-API handoff and telemetry are out of scope: what is being ported
is the flow and the fact dictionary underneath it.

The Flow XML here is **generated output**. Corrections belong in the transpiler, never in the
emitted XML, so that the port stays reproducible against an upstream that is still moving.

## The fact dictionary is a copy, not a translation

`facts/` holds Direct File's 36 modules — 3,030 `<Fact>` elements, ~65,000 lines — carried over
unchanged, together with the `FactDictionaryModule.rng` they were authored under. That works
because `gov.irs:factgraph:3.1.0-SNAPSHOT` is the standalone successor to the v3.0 engine Direct
File runs in production, and because everything the two grammars disagree about is metadata the
engine never reads: `FactConfigElement` takes only `Writable`, `Derived`, `Placeholder`,
`OverrideCondition` and `OverrideDefault` off a `<Fact>`, so `<Name>`, `<Description>`, `<Export>`,
`<ExportZero>`, `<TaxYear>` and `<BlockSubmissionOnTrue>` come along as inert text.

33 of the 36 modules are byte-identical to upstream. Three files differ, and each difference is
recorded below.

### What proved it

A probe flow bound to real fact paths — `/maritalStatus`, `/receivedDigitalAssets`,
`/studentLoanInterestAmount`, with `/isMarried` and `/taxYear` derived — built green, and the
generated `out/app/direct-file/resources/fact-dictionary.xml` carries all 3,030 facts to the
browser. The check has teeth: pointing one `fg-set` at a path that does not exist fails the build
with `InvalidFormConfig: /thisFactDoesNotExist not found in the fact dictionary`.

The probe is gone — the transpiler's output replaced it, as its header said it would — and the
safety net it demonstrated now covers the real thing: 713 screens across 138 pages, and 798
synthesized gate facts whose every dependency is both checked against this dictionary before the XML
is written *and* typed from it, so each condition gets the truthiness test its fact's type needs.

## Deviations from upstream

### `FactDictionaryModule.rng` — widened, twice

The grammar is app-owned here, as it is in every application in this repository, so it is widened
rather than worked around. Both gaps are upstream's grammar failing to describe upstream's own
dictionary; nothing there caught them, because nothing there runs this schema.

| Where | Widened to allow | Used by |
|---|---|---|
| `FilterContent` | an optional `module` attribute, matching `DependencyContent` | `<Filter module="familyAndHousehold" path="/cdccQualifyingPeople">`, 4× in `cdcc.xml` |
| `SubtrahendsContent` | `LogicalContent`, matching `MinuendContent` | `<Subtrahends><Switch>`, 5× in `eitc.xml` |

### `elderlyAndDisabled.xml` — one authoring defect, preserved

`/edcShouldShowCreditOutcomes` writes a `<When>`/`<Then>` pair directly inside its `<Switch>`,
outside any `<Case>`. `Switch.fromDerivedConfig` filters its children to `typeName == "Case"`, so
**the engine has always ignored it**: the fact is a one-case switch that goes `Incomplete` when
`/tpCanBeAskedAboutNonTaxablePayments` is false, rather than the `otherwise true` the author meant.

The pair is commented out here rather than wrapped in a `<Case>`. Wrapping it would fix the bug and
change what the fact evaluates to, and a port whose gate is parity against upstream's 175 snapshot
scenarios is the wrong place to change tax logic. This is worth reporting upstream.

### `standardDeduction.xml` — one stray text node, commented

`/minimumStandardDeduction` carries the citation `Rev Proc .15 Standard Deduction §63(c)(5)` as
bare text inside `<Fact>`, where the grammar expects elements. Wrapped in an XML comment. The
engine ignored it before and ignores it now.

## The flow is generated

The Flow XML under `src/main/resources/direct-file/flow/` is transpiler output and is never
hand-edited, and so is `facts/flowGates.xml` — 798 synthesized Boolean facts, one per distinct set
of screen conditions. See [../codemod/README.md](../codemod/README.md) for the contract, the stage
list, and the condition-operator table the gate facts are built from.

25 modules, 138 pages, 713 screens, 19 collections. `flow/index.xml` lists the modules in flow
order; each module is one Direct File subcategory and each page is a contiguous run of its
declaration order — except that a collection loop's runs are absorbed into a single
`<fg-collection>`, which is what turns 218 runs into 138 pages.

`locales/flow_es.yaml` is still empty, and that is the port's largest remaining gap. Its key set is
owned by the generated `flow_en.yaml`, which the scaffold writes from the emitted XML — so the keys
exist only *after* a build, and re-keying Direct File's own `es.yaml` against them is a post-build
step rather than something stage 4 could have emitted. Direct File has the translations, keyed the
way its `en.yaml` is; what is missing is the step that moves them across. Until then the resolver
falls back to English and the `/es/` pages render English text under Spanish chrome.

## How this application presents its flow

**One question per screen, in every build.** `--singleQuestionPerScreen` is on in `make dev`, `make
site` and the Docker image, which is the opposite of the other three applications. The reason is the
transpiler's central choice: Direct File's 727 screens were collapsed into 138 topic pages, one per
SubSubcategory, with in-page conditions hiding what does not apply. Read at that grain you are
reading the collapse rather than the product — `income/jobs` alone is dozens of questions on one
page. Split back apart it is 343 pages, each one upstream screen, which is the shape Direct File
ships. `make dev-topic-pages` shows the un-split flow, and Author Mode stays un-split because it
edits the XML on disk and the splitter's pages are not on it.

**The step indicator counts sections, not pages.** `fragments/usa-step-indicator.html` overrides the
scaffold's to render one segment per flow module — 25 — labelled from the same
`all-screens.section.*` keys Browse All uses, and it carries `usa-step-indicator--no-labels`. Both
halves are needed. At 138 segments the row ran off the side of the viewport: USWDS sizes a segment
`flex: 1 1 0%` so the bars always fit, but a label cannot shrink below its longest word. And "1 of
138" is not a number anyone tracks, where "4 of 25 — Filing status" is. What is lost is the
per-segment link back to a completed section, since the modifier hides the span that carries it;
those links were already unreachable at 138 segments, and Browse All is this application's
navigation surface.

## Library changes this port needed

Ten in `form-builder` and two in `fact-graph`, all landed in the libraries rather than worked
around here, because each is something another application would want. The first three are gaps; the
rest are defects — constructs Direct File's flow and dictionary use that the libraries mishandled.

1. **`registerInputType()`** in the flow runtime's `input-types.js`. `parser/Input.scala` already
   let an application register a custom `<input type>`; the browser half was hardcoded in five
   `switch (this.inputType)` blocks in `fg-set.js`. Without it each of this port's eight custom
   inputs would have been a wrapper custom element duplicating `fg-set`'s error handling.
2. **`<fg-apply source="/path">`**, the alternative to `value`, for the 73 `SetFactAction`s in
   Direct File's flow. Exactly one of the two is required.
3. **`<fg-collection readonly="true">`**, which renders no Add button and no per-item Remove. Eight
   of this port's nineteen collections iterate a `<Derived><Filter>` collection, whose membership
   another fact decides; on one of those an Add button is not redundant but a crash, since `addItem`
   writes the collection fact. It does not make the fields read-only, which is a different gap
   benefits-enrollment's `review.xml` still names.

4. **`<fg-set>` on a path that reaches its fact through a collection-item alias.** 47 of this port's
   questions write `/primaryFiler/firstName` or `/secondaryFiler/lastName`, where the declared fact
   is `/filers/*/firstName` and `/primaryFiler` is a `<Find>` over `/filers`. Direct File resolves
   these from the screen's `collectionContext`, which Form Builder has no equivalent of, so the alias
   path *is* the expression. `getDefinition` already resolved it; `FgSet` was looking the raw path up
   in `getDefinitionsAsNodes`, a plain map keyed by declared paths, and dying with
   `NoSuchElementException` several frames from anything naming the question. It now asks the
   definition where it lives.
5. **A body-less `<fg-alert>`.** Many Direct File alerts are a heading and nothing else. The parser
   rejected an element with no children left to parse — the right error for an empty `<fg-set>`, the
   wrong one here — so `parseChildElements` grew a `required` flag and the seed grammar says
   `zeroOrMore`.
6. **Per-question DOM ids and translation keys.** A page may ask about one fact twice: two
   conditional branches, only one of which shows, sometimes worded differently ("No, this hasn't
   happened to me" / "…to us", by filing status) and sometimes identically. Both cases used to
   collide. Translation keys now break the tie on the authored content — identical wording shares one
   key and one translation, different wording gets `path-<hash>` — and DOM ids break it again per
   page, so `id`/`name` are unique even where the translation is shared. Ids for a flow with no
   repeats are byte-identical to before.
7. **A guard on over-long translation keys.** `generateFlowLocaleFile` now refuses a key past 128
   characters, naming it. Past that the YAML printer emits the explicit-key form (`? key` / `:
   value`) which the parser reading the file back rejects — so the build wrote a file it could not
   load, and the error surfaced on the next run pointing at a line that looked fine.

8. **`th:utext` on an enum option's label.** `enum.html` and `multi-enum.html` escaped the option
   label on the way out, though `FgSet.scala` had always stored the option's *inner markup* as the
   translation value — so an option could not say "in `<fg-show path="/taxYear"/>"` or bold a box
   number, and the boolean input's options, which use `th:utext`, could. In this port that was not a
   cosmetic limit: 55 of Direct File's option labels interpolate a fact, and a flattened fact
   reference is the empty string, so "I lived in more than 1 state in {{/taxYear}}" reached the page
   without the year and an option whose whole label was the year reached it blank.

9. **`PageSplitter` cuts between blocks when a page has no top-level question.** `--singleQuestionPerScreen`
   was a no-op for this application, silently: the splitter's `flatten` looks through `<section>` and
   `<fg-detail>` and nothing else, and every question here is nested inside the conditional
   `<div class="df-screen">` the transpiler wraps each source screen in. That div cannot be flattened
   away — the condition on it is what decides whether the screen shows, and it lives in the element's
   attributes rather than in a parsed field — so the splitter now cuts *between* the blocks instead,
   emitting each whole. `HtmlWithChildren` carries its parsed condition for that, and `Page` carries
   an explicit `gate` the splitter sets from it, so a block that does not apply is skipped by the
   navigator rather than rendered as a page with nothing on it. No other application changes: a page
   with a top-level question still splits per question, and the three others have no page without one.

10. **The step indicator can group by flow module.** `sections` and `sectionIndex` sit beside the
    `pages` and `stepIndex` the shipped fragment uses, so no existing output moves; an application
    that wants section-level navigation overrides the fragment and reads them. The label is
    deliberately not resolved in the library — which locale key names a module is the application's
    convention. `Page.moduleSlug` moved off `AllScreens`, since both surfaces group by it now.

Two more landed in **`fact-graph`** rather than `form-builder`.

`Pin.apply(String)` called `parseString`, which called `Pin.apply(String)`. Construction goes through
`new` everywhere in the engine so nothing noticed, but the derived `ReadWriter` constructs through
`apply` — so **a saved fact graph holding a `Pin` or an `IpPin` could not be loaded**, with a stack
overflow whose trace named neither type. In an application that is: answer the self-select PIN or an
IP PIN, reload the page, lose the return. Both are fixed, with a round-trip test each. This port's
`pin` and `ip-pin` input types are what walked into it.

`FactDictionary.resolveCollectionAliasPath` cast the first segment of an unresolved path to
`CollectionItemNode` without checking, so any path under a collection that the dictionary does not
declare verbatim raised `ClassCastException` from inside a lookup whose contract is to return null.
It now matches on the node type, and handles the other alias shape as well: `/alaskaPfd1099s` is a
`<Filter>` over `/form1099Miscs`, so `/alaskaPfd1099s/*/writableOtherIncome` resolves — which is what
Direct File's own `SetFactAction` on that path needs.

`<br/>` needed no library change, contrary to the plan: `parser/Html.scala` treats `<p>`, `<li>`,
`<td>` and the headings as leaf nodes and re-emits their inner markup verbatim, so a `<br/>` inside
one already survives. Only this application's `flow/FlowConfig.rng` rejected it, and that grammar
is widened here — as is `fg-apply` itself, which form-builder parses but never described in its
seed grammar, no application here having used one before.

## What proves the port

`make transpile-verify`, and it is worth stating what it establishes because "it builds" does not.

    scenarios          175           # verify-order: every recorded traversal
    violations         0             # …walks the declaration order forwards

    scenarios              161       # verify-visibility: every backend scenario
    screen/item decisions  89329
    agreements             88428
    known differences      901  (7 screens)
    unexpected             0

The first says declaration order is navigation order, so cutting pages from runs of it cannot reorder
a question. The second says a screen shows for exactly the taxpayers it shows for upstream: for each
scenario it builds the fact graph the way Direct File's own snapshot test does, loads that same state
into a graph over this application's dictionary, and compares `Condition.evaluate` against the
synthesized gate fact, screen by screen and collection item by collection item.

Seven screens differ, all seven for a reason on the record: six because Direct File's `isTrue` is
`hasValue && !!get` and `hasValue` is true for a *placeholder*, which the Fact Graph has no CompNode
for; one because it only exists on the e-signature path, which is out of scope. They are enumerated
in `codemod/verify-visibility.ts`'s `KNOWN`, and the check fails on anything else — and on a `KNOWN`
entry that has come back into line, so a stale exemption cannot hide a later regression. See
[../codemod/README.md](../codemod/README.md) for the full account.

`make test` is the third leg, and it is about the dictionary rather than the flow. The cookiecutter
left two starter specs behind — an `EligibilitySpec` reading a `/qualifies` fact this dictionary has
never declared, and a `FlowSpec` asserting a page at route `/`, which Direct File's flow has not got
and no longer needs. Four assertions were red on every run from the moment the 36 real modules
landed, which is worse than no gate at all. They now assert this application:

  - **`DeterminationSpec`** loads all 161 scenarios in `scenarios/` through this dictionary, checks
    that `overpayment - balanceDue == totalPayments - totalTax` and that a refund is due exactly
    when there is an overpayment on every one of them, and pins two named returns — `HOH_32k_EITC`,
    a head-of-household filer with one qualifying child and a $2,726 EITC, and `ats_1`, a single
    filer with neither. The corpus is upstream's own backend fixtures, so the inputs are Direct
    File's rather than invented here, and the loadability check guards both directions: a dictionary
    edit the corpus no longer fits, and a corpus the dictionary cannot read.
  - **`FlowSpec`** asserts the shape the transpiler promises: 138 unique routes, every one of them
    `/category/subcategory/subsubcategory` under one of the five categories, every page stamped with
    the module it came from, and every route in step with that module's filename.

## The workspace over it

Standard mount — the cookiecutter's four fragments, filled in. Three things in it are Direct File's
rather than the template's:

- **The Outcome tracker's five outcomes**, in `website-static/js/taxpert/direct-file-graph.js`: the
  return, then each of the four credits that can move it (EITC, CTC/ODC, CDCC, PTC), because "why is
  this number what it is" is the question the tracker exists to answer and the answer is nearly
  always a credit. The headline is `/dueRefund` as a boolean rather than a signed amount: Direct File
  has no fact that runs positive for a refund and negative for a balance due — `/overpayment` and
  `/balanceDue` are both clamped at zero by a `<GreaterOf>`, so one of them is always $0 — and
  `/dueRefund` / `/owesBalance` are the booleans the payment-method screens already branch on.
- **The Browse All section headings**, one per flow module, in `locales/en.yaml` and `es.yaml`. Each
  is Direct File's own `checklist.{subcategoryRoute}.heading`, in both languages, because a flow
  module here *is* one of its subcategories. This is the one place Spanish is real before stage 4.
- **The Applications switcher**, listing all four applications in this repository. The three siblings
  are added to this app's `taxpert-config.html` and this app to each of theirs, so the workspace
  carries over from any one of them to any other.

`brand.css` is deliberately still the cookiecutter's empty placeholder. The theme is USWDS and so is
Direct File; there is no token this application needs to re-tint, and benefits-enrollment left the
same file untouched for the same reason. Inventing a palette to have written something would be
worse than the blank file.

## Hazards

- **`make format` here does not touch the XML, and that is on purpose.** The other three
  applications run `xmllint --format` over their fact configs; doing that here rewrites all 36
  modules and destroys the byte-for-byte correspondence with upstream that makes the copy auditable
  — silently, in one command, as a 16,000-line diff. The target was changed rather than the advice:
  a hazard a Makefile can simply not have is better than a hazard documented in a file nobody reads
  first. `flow/` is generated, so there is nothing to format there either.
- **`facts/*.xml` merge in sorted filename order, last `<Fact path>` wins.** Direct File ships a
  `flow.xml` in its `tax/` directory; it is a *fact* module about flow state, and it belongs in
  `facts/`, not in `flow/`.

## One build.sbt setting the other applications do not have

`Compile / unmanagedResources / excludeFilter` prunes two generated trees as well as `flow_en.yaml`:
`src/main/resources/direct-file/node_modules` (14,638 files of lint tooling — eslint, html-validate,
and the USWDS distribution `make copy-uswds` lifts out of it) and
`website-static/vendor/` (2,683 files: the taxpert, USWDS and Fact Graph mirrors, all gitignored,
each with exactly one writer).

Neither is ever read from the classpath. The site generator reads `website-static/` from disk —
`Website.scala` does `os.copy(app.websiteStaticDir, …)` — and the Dockerfile serves `out/` from
nginx rather than running the jar. So 17,000 files were being copied into `target/classes` and
packaged for nothing.

### The intermittent build failure, correctly diagnosed the second time

An earlier version of this section claimed the exclusion *fixed* a `FileNotFoundException` in
`Compile / packageBin`, and attributed that failure to a file-count threshold — "past roughly 16,000
files the copy and the packaging step disagree". **That was wrong**, and the exclusion does not fix
it. The failure still happens, now sometimes as `ClassNotFoundException: gov.irs.directfile.main`.

The cause is two sbt builds sharing one output directory. `docker-compose.override.yml` runs a watch
container that bind-mounts this repository at `/build/direct-file-form-builder` and runs `sbt ~run`
inside it, so `target/scala-3.7.2/classes` has two writers. `make copy-uswds` opens with an `rm -rf`
of its target, which retriggers that watcher on *every* host build — the container's own log records
`Build triggered by …/uswds-3.13.0/img/material-icons/wash.svg`, and then the same exception on the
same shared path. Whichever build is mid-`packageBin` when the other is mid-`copyResources` dies.

- **Workaround:** `make down` (or stop that one container) before running host builds.
- **Fix:** give the container its own `target/`, in the compose files. That is the same change in all
  four applications and has deliberately not been made from here.

**Neither the flake nor the resource trees are something the port introduced.** Every application in
this repository keeps a `node_modules` and a `website-static/vendor/` under `src/main/resources`, and
every one of them has a watch container that bind-mounts its own repository the same way.
