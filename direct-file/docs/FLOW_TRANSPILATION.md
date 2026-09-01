# Transpiling Direct File JSX into Form Builder XML

## Overview
This application is a port of the questionnaire in
[IRS Direct File](https://github.com/IRS-Public/direct-file)'s `df-client-app` onto
`gov.irs::form-builder`, with the `taxpert` workspace over it. What is ported is the JSX flow and the
fact dictionary underneath it. Many things, in particular authentication/authorization, MeF submission, PDF generation, 
data import, and the state-API are out of scope.

The Form Builder compliance Flow XML is generated output of the codemod scripts. Corrections belong in the transpiler 
rather than 
in the
emitted XML, so the port stays reproducible against an upstream that is still moving. See
[../codemod/README.md](../codemod/README.md). At a certain point in the future when the transpiled code is deemed 
'good enough,' hand edits to the Flow XML and Locales can be made. 

Direct File's Fact Dictionaries were copied over practically verbatim across 3,030 `<Fact>` 
elements and roughly 65,000 lines, together
with the `FactDictionaryModule.rng.` 33 of the 36 modules are byte-identical, and the other three that differ are 
recorded [below](#locales).


## Flow Transpilation

The Flow XML under `src/main/resources/direct-file/flow/` is transpiler output and is never
hand-edited, and so is `facts/flowGates.xml`, which holds 798 synthesized Boolean facts, one per
distinct set of screen conditions, plus `/flowAlwaysTrue`.

Each module is one Direct File subcategory, and each page is a contiguous run of its declaration
order. A collection loop's runs are absorbed into a single `<fg-collection>`, which is what turns 218
runs into 138 pages.

`locales/flow_es.yaml` is generated too, but by a separate stage and after a build rather than
before one. See below.


### One question per screen

`--singleQuestionPerScreen` is on in `make dev` and `make site`, which is the opposite of the other
three applications. The reason is the transpiler's central choice. Direct
File's 727 screens are collapsed into 138 topic pages, one per SubSubcategory, with in-page
conditions hiding what does not apply. At that grain `income/jobs` alone is dozens of questions on
one page. Split back apart it is 378 pages, each one upstream screen, which is the shape Direct File
ships.

`make dev-topic-pages` shows the un-split flow. Author Mode stays un-split because it edits the XML
on disk, and the splitter's pages are not on disk. `make up` runs the Author Mode watcher, so the
Docker stack serves the un-split flow as well.

### Step indicator

`templates/fragments/usa-step-indicator.html` overrides the scaffold's to render one segment per flow
module, 25 of them, labeled from the same `all-screens.section.*` keys Browse All uses. It also
carries `usa-step-indicator--no-labels`.

At 138 segments the row ran off the side of the viewport. USWDS sizes a
segment `flex: 1 1 0%`, so the bars themselves always fit, but a label cannot shrink below its
longest word, and 25 labels do not fit either. The header already reads "4 of 25, Filing status",
which carries the information the labels did.

What is lost is the per-segment link back to a completed section, since the modifier hides the span
that carries it. Those links were already unreachable at 138 segments, and Browse All is this
application's navigation surface.

### Parity against JSX Direct File

`make transpile-verify` runs two checks.

    scenarios          175           # verify-order: every recorded traversal
    violations         0             # walks the declaration order forwards

    scenarios              161       # verify-visibility: every backend scenario
    screen/item decisions  89329
    agreements             88428
    known differences      901  (7 screens)
    unexpected             0

The first check verifies that the declaration order is navigation order, i.e. splitting pages cannot
reorder a question. The second check verifies that a screen shows for exactly the taxpayers it shows for upstream.
For each scenario it builds the fact graph the way Direct File's own snapshot test does, loads that
same state into a graph over this application's dictionary, and compares `Condition.evaluate` against
the synthesized gate fact, screen by screen and collection item by collection item.


## Locales

Every one of `flow_es.yaml`'s 7,684 values is a string Direct File already wrote.
`make transpile-es` is what ports the Spanish translations, and it is apart from `make transpile` because **its
input is the library's output.** form-builder does not carry a translation key through from the XML.
It invents one per leaf while it parses, `"$label-${md5(content).take(6)}"` over the *English* words
(`TranslationContext.getHashKey`). `about-you-intro`'s subtree is `h2-6ee87d` and `p-04cb15`, not
anything Direct File's `en.yaml` calls them. So there is no key in `flow_en.yaml` that is also a key
upstream.

What the translation stage does instead is resolve every screen's content **twice**, out of `en.yaml` and out of
`es.yaml`, through the same component mapper and the same printer. The two trees are joined on the shape they share 
rather than on a
position, and that gives, per page, a map from the exact English text form-builder stored to its
Spanish. The generated `flow_en.yaml` is then read back and each value looked up in that map. The
pairing is therefore validated by the English text itself: a key only takes a translation when the
transpiler can show it produced that same English on that same page. All of the i18n keys were mapped; see 
`codemod/translation-coverage.
md` for a summary and the code in
`codemod/verify-translation.ts` for how this was verified.

Three additional items:
- **204 values are one English sentence with two translations.** Upstream writes the same sentence
under two keys and translates each in its own words. There is one key here to put either under,
because form-builder has already collapsed the two on the English, so the first occurrence on the
page wins. 
- **16 values interpolate different facts in the two languages**: "hasta el 15 de abril de
{{/nextTaxYear}}" where the English says "for {{/lastTaxYear}}". That is upstream's own wording, and
the dictionary check above is what makes it safe to take.
- **This is a bulk seed rather than a replacement for `syncTranslationLocales`.** The keys are
content-addressed on the English, so a later edit to the flow re-keys its entry here exactly as it
would a hand-written translation. Re-running `make transpile-es` after `make transpile && make site` reseeds from upstream.


## Fact Dictionary Changes

### `FactDictionaryModule.rng`
Direct File's original `FactDictionaryModule.rng` was never required and as a result was incomplete. Form Builder 
applications adhere more closer to the RNG specs, and as a result certain changes were needed to bring the 
transpiled XML in line with the RNG:

| Where | Widened to allow | Used by |
|---|---|---|
| `FilterContent` | an optional `module` attribute, matching `DependencyContent` | `<Filter module="familyAndHousehold" path="/cdccQualifyingPeople">`, 4 times in `cdcc.xml` |
| `SubtrahendsContent` | `LogicalContent`, matching `MinuendContent` | `<Subtrahends><Switch>`, 5 times in `eitc.xml` |

### `elderlyAndDisabled.xml`

`/edcShouldShowCreditOutcomes` writes a `<When>` and `<Then>` pair directly inside its `<Switch>`,
outside any `<Case>`. `Switch.fromDerivedConfig` filters its children to `typeName == "Case"`, so the
engine has always ignored it. The fact is a one-case switch that goes `Incomplete` when
`/tpCanBeAskedAboutNonTaxablePayments` is false, rather than the `otherwise true` the author meant. The pair is commented out here rather than wrapped in a `<Case>`. Wrapping it would fix the bug and
change what the fact evaluates to.

## Rough Edges

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
bind-mounts this repository at `/build/direct-file` and runs `sbt ~run` inside it, so
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
