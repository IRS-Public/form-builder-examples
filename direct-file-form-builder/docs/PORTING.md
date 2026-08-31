# Porting Direct File onto Form Builder

This application is a port of the questionnaire in
[IRS Direct File](https://github.com/IRS-Public/direct-file)'s `df-client-app` onto
`gov.irs::form-builder`, with the `taxpert` workspace over it. What is ported is the flow and the
fact dictionary underneath it. Auth, MeF submission, PDF generation, data import, the state-API
handoff and telemetry are out of scope.

The Flow XML here is generated output. Corrections belong in the transpiler rather than in the
emitted XML, so the port stays reproducible against an upstream that is still moving. See
[../codemod/README.md](../codemod/README.md).

## The fact dictionary is carried over unchanged

`facts/` holds Direct File's 36 modules, 3,030 `<Fact>` elements over roughly 65,000 lines, together
with the `FactDictionaryModule.rng` they were authored under. A 37th module, `flowGates.xml`, is
generated.

Copying works for two reasons. `gov.irs:factgraph:3.1.0-SNAPSHOT` is the standalone successor to the
v3.0 engine Direct File runs in production. And everything the two grammars disagree about is
metadata the engine never reads: `FactConfigElement` takes only `Writable`, `Derived`, `Placeholder`,
`OverrideCondition` and `OverrideDefault` off a `<Fact>`, so `<Name>`, `<Description>`, `<Export>`,
`<ExportZero>`, `<TaxYear>` and `<BlockSubmissionOnTrue>` come along as inert text.

33 of the 36 modules are byte-identical to upstream. The three that differ are recorded below.

### What proved it

The generated `out/app/direct-file/resources/fact-dictionary.xml` carries all 3,030 facts to the
browser, and the flow parser validates every `path=` in the flow against the dictionary before
writing any HTML. Pointing one `fg-set` at a path that does not exist fails the build with
`InvalidFormConfig: /thisFactDoesNotExist not found in the fact dictionary`.

That safety net now covers 713 screens across 138 pages and 798 synthesized gate facts. Every
dependency in a gate is checked against this dictionary before the XML is written, and typed from it,
so each condition gets the truthiness test its fact's type needs.

## Deviations from upstream

### `FactDictionaryModule.rng`, widened twice

The grammar is app-owned here, as it is in every application in this repository, so it is widened
rather than worked around. In both cases upstream's grammar fails to describe upstream's own
dictionary. Nothing there caught it, because nothing there runs this schema.

| Where | Widened to allow | Used by |
|---|---|---|
| `FilterContent` | an optional `module` attribute, matching `DependencyContent` | `<Filter module="familyAndHousehold" path="/cdccQualifyingPeople">`, 4 times in `cdcc.xml` |
| `SubtrahendsContent` | `LogicalContent`, matching `MinuendContent` | `<Subtrahends><Switch>`, 5 times in `eitc.xml` |

### `elderlyAndDisabled.xml`, one authoring defect preserved

`/edcShouldShowCreditOutcomes` writes a `<When>` and `<Then>` pair directly inside its `<Switch>`,
outside any `<Case>`. `Switch.fromDerivedConfig` filters its children to `typeName == "Case"`, so the
engine has always ignored it. The fact is a one-case switch that goes `Incomplete` when
`/tpCanBeAskedAboutNonTaxablePayments` is false, rather than the `otherwise true` the author meant.

The pair is commented out here rather than wrapped in a `<Case>`. Wrapping it would fix the bug and
change what the fact evaluates to. A port whose gate is parity against upstream's 175 snapshot
scenarios is the wrong place to change tax logic. This is worth reporting upstream.

### `standardDeduction.xml`, one stray text node commented

`/minimumStandardDeduction` carries the citation `Rev Proc .15 Standard Deduction §63(c)(5)` as bare
text inside `<Fact>`, where the grammar expects elements. It is wrapped in an XML comment here. The
engine ignored it before and ignores it now.

## The flow is generated

The Flow XML under `src/main/resources/direct-file/flow/` is transpiler output and is never
hand-edited, and so is `facts/flowGates.xml`, which holds 798 synthesized Boolean facts, one per
distinct set of screen conditions, plus `/flowAlwaysTrue`.

25 modules, 138 pages, 713 screens, 19 collections. `flow/index.xml` lists the modules in flow order.
Each module is one Direct File subcategory, and each page is a contiguous run of its declaration
order. A collection loop's runs are absorbed into a single `<fg-collection>`, which is what turns 218
runs into 138 pages.

`locales/flow_es.yaml` holds 15 lines, and that is the port's largest remaining gap. Its key set is
owned by the generated `flow_en.yaml`, which the scaffold writes from the emitted XML, so the keys
exist only after a build. Re-keying Direct File's own `es.yaml` against them is a post-build step
rather than something the transpiler could emit. Direct File has the translations, keyed the way its
`en.yaml` is. What is missing is the step that moves them across. Until then the resolver falls back
to English and the `/es/` pages render English text under Spanish chrome.

## How this application presents its flow

### One question per screen, in every build

`--singleQuestionPerScreen` is on in `make dev`, `make site` and the Docker image, which is the
opposite of the other three applications. The reason is the transpiler's central choice. Direct
File's 727 screens are collapsed into 138 topic pages, one per SubSubcategory, with in-page
conditions hiding what does not apply. At that grain `income/jobs` alone is dozens of questions on
one page. Split back apart it is 378 pages, each one upstream screen, which is the shape Direct File
ships.

`make dev-topic-pages` shows the un-split flow. Author Mode stays un-split because it edits the XML
on disk, and the splitter's pages are not on disk.

### The step indicator counts sections

`templates/fragments/usa-step-indicator.html` overrides the scaffold's to render one segment per flow
module, 25 of them, labelled from the same `all-screens.section.*` keys Browse All uses. It also
carries `usa-step-indicator--no-labels`.

Both halves are needed. At 138 segments the row ran off the side of the viewport. USWDS sizes a
segment `flex: 1 1 0%`, so the bars themselves always fit, but a label cannot shrink below its
longest word, and 25 labels do not fit either. The header already reads "4 of 25, Filing status",
which carries the information the labels did.

What is lost is the per-segment link back to a completed section, since the modifier hides the span
that carries it. Those links were already unreachable at 138 segments, and Browse All is this
application's navigation surface.

### `Result.get` throws on an incomplete result

The input modules this application registers read the fact in their `write` handler.
`Result.get` throws `NoSuchElementException` rather than returning undefined, so `fact?.get` threw
out of `connectedCallback` on every page holding an unanswered address, TIN, EIN, PIN, IP PIN, phone
number or bank account, aborting the rest of that element's render. They test `fact?.complete` first
now. `value` is already `''` when incomplete, which is what the registry's contract offers for this.

## Library changes this port needed

Eleven in `form-builder` and two in `fact-graph`. Each landed in the library rather than being worked
around here, because each is something another application would want. The first three are gaps in
what the libraries offered. The rest are defects, meaning constructs Direct File's flow and dictionary
use that the libraries mishandled.

### Gaps

1. **`registerInputType()`** in the flow runtime's `input-types.js`. `parser/Input.scala` already let
   an application register a custom `<input type>`, but the browser half was hardcoded in five
   `switch (this.inputType)` blocks in `fg-set.js`. Without it, each of this port's eight custom
   inputs would have been a wrapper custom element duplicating `fg-set`'s error handling.
2. **`<fg-apply source="/path">`**, the alternative to `value`, for the 73 `SetFactAction`s in Direct
   File's flow. Exactly one of the two is required.
3. **`<fg-collection readonly="true">`**, which renders no Add button and no per-item Remove. Eight of
   this port's nineteen collections iterate a `<Derived><Filter>` collection whose membership another
   fact decides. On one of those, an Add button is a crash rather than a redundancy, because `addItem`
   writes the collection fact and a derived fact does not accept a write. It does not make the fields
   read-only, which is a separate gap that benefits-enrollment's `review.xml` still names.

### Defects

4. **`<fg-set>` on a path that reaches its fact through a collection-item alias.** 47 of this port's
   questions write `/primaryFiler/firstName` or `/secondaryFiler/lastName`, where the declared fact is
   `/filers/*/firstName` and `/primaryFiler` is a `<Find>` over `/filers`. Direct File resolves these
   from the screen's `collectionContext`, which Form Builder has no equivalent of, so the alias path
   is the expression. `getDefinition` already resolved it. `FgSet` was looking the raw path up in
   `getDefinitionsAsNodes`, a plain map keyed by declared paths, and dying with
   `NoSuchElementException` several frames from anything naming the question. It now asks the
   definition where it lives.
5. **A body-less `<fg-alert>`.** Many Direct File alerts are a heading and nothing else. The parser
   rejected an element with no children left to parse, which is the right error for an empty
   `<fg-set>` and the wrong one here. `parseChildElements` grew a `required` flag, and the seed
   grammar says `zeroOrMore`.
6. **Per-question DOM ids and translation keys.** A page may ask about one fact twice, in two
   conditional branches of which only one shows, sometimes worded differently ("No, this hasn't
   happened to me" against "…to us", by filing status) and sometimes identically. Both cases used to
   collide. Translation keys now break the tie on the authored content, so identical wording shares
   one key and different wording gets `path-<hash>`. DOM ids break it again per page, so `id` and
   `name` are unique even where the translation is shared. Ids for a flow with no repeats are
   byte-identical to before.
7. **A guard on over-long translation keys.** `generateFlowLocaleFile` refuses a key past 128
   characters, naming it. Past that the YAML printer emits the explicit-key form (`? key` on its own
   line, then `: value`), which the parser reading the file back rejects. The build wrote a file it
   could not load, and the error surfaced on the next run pointing at a line that looked fine.
8. **`th:utext` on an enum option's label.** `enum.html` and `multi-enum.html` escaped the option
   label on the way out, though `FgSet.scala` had always stored the option's inner markup as the
   translation value. So an option could not say "in `<fg-show path="/taxYear"/>`" or bold a box
   number, while the boolean input's options, which use `th:utext`, could. Here that was not a
   cosmetic limit. 55 of Direct File's option labels interpolate a fact, and a flattened fact
   reference is the empty string, so "I lived in more than 1 state in {{/taxYear}}" reached the page
   without the year, and an option whose whole label was the year reached it blank.
9. **`PageSplitter` cuts between blocks when a page has no top-level question.**
   `--singleQuestionPerScreen` was a silent no-op for this application. The splitter's `flatten` looks
   through `<section>` and `<fg-detail>` and nothing else, and every question here is nested inside
   the conditional `<div class="df-screen">` the transpiler wraps each source screen in. That div
   cannot be flattened away, because the condition on it decides whether the screen shows and it lives
   in the element's attributes rather than in a parsed field. The splitter now cuts between the blocks
   and emits each whole. `HtmlWithChildren` carries its parsed condition for that, and `Page` carries
   an explicit `gate` the splitter sets from it, so a block that does not apply is skipped by the
   navigator rather than rendered as a page with nothing on it. No other application changes: a page
   with a top-level question still splits per question, and the other three have no page without one.
10. **The step indicator can group by flow module.** `sections` and `sectionIndex` sit beside the
    `pages` and `stepIndex` the shipped fragment uses, so no existing output moves. An application
    that wants section-level navigation overrides the fragment and reads them. The library does not
    resolve the label, because which locale key names a module is the application's convention.
    `Page.moduleSlug` moved off `AllScreens`, since both surfaces group by it now.
11. **A knockout inside a hidden wrapper no longer blocks Continue.** `validateSectionForNavigation`
    asked for `fg-alert[knockout="true"]:not(.hidden)`, which reads the alert's own class and nothing
    above it. A condition hides the element that carries it, and in this flow a knockout's condition
    is on the wrapping `<div class="df-screen df-knockout">` while the alert inside it is authored
    `condition="/flowAlwaysTrue"`. The wrapper was hidden, the alert was not, and Continue concluded
    the taxpayer was knocked out. It refused to navigate and said nothing: every field answered, no
    error message, no movement, on any topic page carrying a knockout. The `<fg-set>` check two lines
    above had always read the same question correctly with `closest('.hidden')`.
    `visibleKnockoutAlert()` makes the two agree, and `tests/fg-validation.test.mjs` pins it.

### Two in `fact-graph`

`Pin.apply(String)` called `parseString`, which called `Pin.apply(String)`. Construction goes through
`new` everywhere in the engine, so nothing noticed, but the derived `ReadWriter` constructs through
`apply`. A saved fact graph holding a `Pin` or an `IpPin` could not be loaded, with a stack overflow
whose trace named neither type. In an application that means answering the self-select PIN or an IP
PIN, reloading the page, and losing the return. Both are fixed, with a round-trip test each. This
port's `pin` and `ip-pin` input types are what walked into it.

`FactDictionary.resolveCollectionAliasPath` cast the first segment of an unresolved path to
`CollectionItemNode` without checking, so any path under a collection that the dictionary does not
declare verbatim raised `ClassCastException` from inside a lookup whose contract is to return null.
It now matches on the node type, and handles the other alias shape as well: `/alaskaPfd1099s` is a
`<Filter>` over `/form1099Miscs`, so `/alaskaPfd1099s/*/writableOtherIncome` resolves, which is what
Direct File's own `SetFactAction` on that path needs.

### One thing that needed no library change

`<br/>` was expected to need one and did not. `parser/Html.scala` treats `<p>`, `<li>`, `<td>` and the
headings as leaf nodes and re-emits their inner markup verbatim, so a `<br/>` inside one already
survives. Only this application's `flow/FlowConfig.rng` rejected it, and that grammar is widened
here. The same is true of `fg-apply`, which form-builder parses but never described in its seed
grammar, no application here having used one before.

## What proves the port

### Parity against Direct File

`make transpile-verify` runs two checks.

    scenarios          175           # verify-order: every recorded traversal
    violations         0             # walks the declaration order forwards

    scenarios              161       # verify-visibility: every backend scenario
    screen/item decisions  89329
    agreements             88428
    known differences      901  (7 screens)
    unexpected             0

The first says declaration order is navigation order, so cutting pages from runs of it cannot
reorder a question. The second says a screen shows for exactly the taxpayers it shows for upstream.
For each scenario it builds the fact graph the way Direct File's own snapshot test does, loads that
same state into a graph over this application's dictionary, and compares `Condition.evaluate` against
the synthesized gate fact, screen by screen and collection item by collection item.

Seven screens differ, each for a reason on the record. Six are because Direct File's `isTrue` is
`hasValue && !!get`, and `hasValue` is true for a placeholder, which the Fact Graph has no CompNode
for. The seventh exists only on the e-signature path, which is out of scope. They are enumerated in
`codemod/verify-visibility.ts`'s `KNOWN`, and the check fails on anything else. It also fails on a
`KNOWN` entry that has come back into line, so a stale exemption cannot hide a later regression.

### The dictionary and the flow shape

`make test` is about the dictionary rather than the flow.

- **`DeterminationSpec`** loads all 161 scenarios in `scenarios/` through this dictionary. It checks
  that `overpayment - balanceDue == totalPayments - totalTax` and that a refund is due exactly when
  there is an overpayment, on every one of them, and it pins two named returns: `HOH_32k_EITC`, a
  head-of-household filer with one qualifying child and a $2,726 EITC, and `ats_1`, a single filer
  with neither. The corpus is upstream's own backend fixtures, so the inputs are Direct File's rather
  than invented here. The loadability check guards both directions: a dictionary edit the corpus no
  longer fits, and a corpus the dictionary cannot read.
- **`FlowSpec`** asserts the shape the transpiler promises: 138 unique routes, every one of them
  `/category/subcategory/subsubcategory` under one of the five categories, every page stamped with the
  module it came from, and every route in step with that module's filename.

Both replaced starter specs the cookiecutter left behind. `EligibilitySpec` read a `/qualifies` fact
this dictionary has never declared, and `FlowSpec` asserted a page at route `/`, which Direct File's
flow does not have and no longer needs. Four assertions were red on every run from the moment the 36
real modules landed.

### That the site runs

`make smoke` is seven Playwright assertions over the first few pages. It exists because the parity
gates never render a page, so they cannot see a fact path the browser cannot write, an input type
that fails to register, or a module that throws at import. Two of its assertions are pinned
regressions: the second filer's seeding, and the `Result.get` throw above. See `tests/smoke.spec.js`.

## The workspace over it

The cookiecutter's four fragments, filled in. Three things in it are Direct File's rather than the
template's:

- **The Outcome tracker's five outcomes**, in `website-static/js/taxpert/direct-file-graph.js`: the
  return, then each of the four credits that can move it (EITC, CTC/ODC, CDCC, PTC). "Why is this
  number what it is" is the question the tracker exists to answer, and the answer is nearly always a
  credit. The headline is `/dueRefund` as a boolean rather than a signed amount. Direct File has no
  fact that runs positive for a refund and negative for a balance due, because `/overpayment` and
  `/balanceDue` are both clamped at zero by a `<GreaterOf>`, so one of them is always $0.
  `/dueRefund` and `/owesBalance` are the booleans the payment-method screens already branch on.
- **The Browse All section headings**, one per flow module, in `locales/en.yaml` and `es.yaml`. Each
  is Direct File's own `checklist.{subcategoryRoute}.heading`, in both languages, because a flow
  module here is one of its subcategories. This is the one place Spanish is real today. The step
  indicator reads the same keys.
- **The Applications switcher**, listing all four applications in this repository. The three siblings
  are added to this app's `taxpert-config.html` and this app to each of theirs, so the workspace
  carries over from any one of them to any other.

`brand.css` is deliberately still the cookiecutter's placeholder, with no declarations in it. The
theme is USWDS and so is Direct File, so there is no token this application needs to re-tint.
benefits-enrollment left the same file untouched for the same reason.

## Hazards

- **`make format` does not touch the XML here.** The other three applications run `xmllint --format`
  over their fact configs. Doing that here rewrites all 36 modules in one command and destroys the
  byte-for-byte correspondence with upstream that makes the copy auditable, as a 16,000-line diff.
  The target was changed rather than the advice, because a hazard a Makefile cannot have is better
  than one documented in a file nobody reads first. `flow/` is generated, so there is nothing to
  format there either.
- **`facts/*.xml` merge in sorted filename order, and the last `<Fact path>` wins.** Direct File
  ships a `flow.xml` in its `tax/` directory. It is a fact module about flow state, so it belongs in
  `facts/` rather than in `flow/`.

## One build.sbt setting the other applications do not have

`Compile / unmanagedResources / excludeFilter` prunes two generated trees as well as `flow_en.yaml`:
`src/main/resources/direct-file/node_modules` (14,638 files of lint tooling, including the USWDS
distribution `make copy-uswds` lifts out of it) and `website-static/vendor/` (2,683 files of taxpert,
USWDS and Fact Graph mirrors, all gitignored, each with exactly one writer).

Neither is ever read from the classpath. The site generator reads `website-static/` from disk, since
`Website.scala` does `os.copy(app.websiteStaticDir, …)`, and the Dockerfile serves `out/` from nginx
rather than running the jar. So 17,000 files were being copied into `target/classes` and packaged for
nothing.

### The intermittent build failure

`make ci` fails roughly one run in three with a `FileNotFoundException` or a
`ClassNotFoundException` naming something under `target/`. The exclusion above does not fix it, and
an earlier version of this document was wrong to say it did, and wrong about the cause.

Two sbt builds share one output directory. `docker-compose.override.yml` runs a watch container that
bind-mounts this repository at `/build/direct-file-form-builder` and runs `sbt ~run` inside it, so
`target/scala-3.7.2/classes` has two writers. `make copy-uswds` opens with an `rm -rf` of its target,
which retriggers that watcher on every host build. The container's own log records
`Build triggered by …/uswds-3.13.0/img/material-icons/wash.svg`, and then the same exception on the
same shared path. Whichever build is mid-`packageBin` when the other is mid-`copyResources` dies.

- **Workaround:** `make down`, or stop that one container, before running host builds.
- **Fix:** give the container its own `target/`, in the compose files. That is the same change in all
  four applications and has deliberately not been made from here.

Neither the flake nor the resource trees are something this port introduced. Every application in
this repository keeps a `node_modules` and a `website-static/vendor/` under `src/main/resources`, and
every one of them has a watch container that bind-mounts its own repository the same way.
