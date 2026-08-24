# Benefits Enrollment

A combined SNAP and Medicaid application, built as a Form Builder application. Flow XML describes
the questions, a fact dictionary describes the facts behind them, and `gov.irs::form-builder` turns
the two into a site: every page as plain HTML under `./out`.

This repository holds the domain. The flow, the facts, the locales, the brand styling, and a
`Main.scala` of about 40 lines. Everything else comes from the libraries below.

Serves from `/app/benefits`.

## Where this came from

This is a conversion of a [benefits enrollment
prototype](https://github.com/usds/benefits-enrollment-prototype), a 2016 Jekyll site of 121 static
pages that kept all its state in `sessionStorage` and expressed all its logic as inline `<script>`
blocks reading `window` globals and assigning `window.location.href`.

Most of those 121 pages were duplication: `person1`…`person6` copies of the same four screens across
four directories. Here they are one `<fg-collection>` over `/householdMembers` in
`flow/household.xml`, which is why the flow is seven modules rather than eight directories of
near-identical HTML.

Three things follow from that, and they are worth knowing before reading the flow:

**The applicant is a row in the collection, rather than a set of singleton facts.** The prototype stored the
applicant as `applicant*` keys and everyone else as `householdMember{1..6}*`, then asked both a
near-identical battery of questions. Credit Assistant's split (primary filer as singletons, a
collection for everyone else) does not transfer, because here the two batteries almost entirely
overlap. Membership is marked by `/householdMembers/*/isSelf`, which is a real question rather than
an assumed first row: the prototype's own "On behalf of one or more people" option means the person
filling in the form may not be on the application at all.

**The two household sizes are derived, rather than asked.** `householdSize` and `householdShareMeals` were
hand-entered integers that then drove DOM removal loops. They are now `CollectionSize` over two
`Filter` aliases in `facts/populations.xml`. The tax household and the meal-share household are
genuinely different populations, and one can be a strict subset of the other.

**Jobs are three fixed slots per person, matching the prototype's own cap.** A nested
`/householdMembers/*/jobs` collection is supported by the fact graph but not yet by the browser
runtime. See "Known issues" below.

The prototype's hand-indexed bugs (every `personN-step2` falling back to `person1`, `person5`
testing `householdMember5FirstName` instead of `6`, all six `personN-document` pages sharing the
un-namespaced key `alienNumberNumber`) are not fixed here. They are unrepresentable: there is no
per-person page to misroute and no shared key to overwrite.

The one eligibility rule the prototype had is ported verbatim: a flat $10,000 over 30 days, not
adjusted for household size or program. See `facts/eligibility.xml`, which says so in a
`<Description>`, and `EligibilitySpec`, which pins all five cases including the Medicaid-only path
that was never asked for income at all.

## What this is built on

| Library | Where | What it gives you |
|---|---|---|
| `gov.irs::factgraph` | `../fact-graph` | The fact evaluation engine, as a JVM jar and a Scala.js browser bundle. |
| `gov.irs::form-builder` | `../form-builder` | The scaffold: flow parser, site generators, Thymeleaf engine, node templates, chrome locales, the theme and the browser flow runtime. |
| `taxpert` | `../taxpert/packages/ui` | The workspace laid over the running app: global nav, audit panel, and the Inspect / Outcome tracker / Watchlist tool panels. Optional, and this app was generated with it. |

Each is resolved from a local checkout rather than a remote, so this app expects each at the path
above. Those are the answers it was generated with, resolved from this app's own directory rather
than assumed to be siblings. If a library moves, update the path in the `Makefile`, `package.json`,
`Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml` and the checkout `path:`s in
`.github/workflows/ci.yml`.

The default layout, and the one CI assumes:

```
parent/
├── fact-graph/
├── form-builder/
├── taxpert/
│   └── packages/ui/    the workspace package this app depends on
└── benefits-enrollment/
```

## Requirements

JDK 21, sbt, Node 22, and `xmllint` for the XML validators (`libxml2-utils` on Debian or Ubuntu).

`build.sbt` names one dependency, `gov.irs %% "form-builder"`, and declares no resolvers. Both that
library and the `gov.irs::factgraph` it pulls in transitively are resolved from the local Ivy cache
at `~/.ivy2/local`, so each has to be published there once from its checkout. `make bootstrap` does
that for you. Neither library is published to a remote artifact registry, so publishing locally
from each checkout is the only route to them.

## Getting started

```bash
make bootstrap    # once: publish the libraries, install deps, vendor their assets
make dev          # http://localhost:3006/app/benefits/
```

Or skip the local toolchain entirely with `make up`, which builds the libraries, generates the site,
serves it, and leaves an `sbt ~run` watcher regenerating on every edit. Same URL, same flags.

`make help` lists every target. The ones you will use:

| Target | What it does |
|---|---|
| `make dev` | Dev server with the developer surfaces this app was generated with, watching for changes. |
| `make dev-author` | The same, plus Author Mode: edit flow text and fact values from the browser, backed by a local API on port 3004. |
| `make dev-one-question` | The same, split into one question per screen. |
| `make debug` | The same, with a JVM debug port on 5005. |
| `make site` | The production build into `./out`. No flags, so the flow and nothing else. |
| `make test` | ScalaTest, plus a scalafmt check. `make test-watch` for the watching version. |
| `make format` | Format the Scala, the fact XML and the JavaScript. |
| `make ci` | Build, then every validator in turn. `make ci-setup` installs what the validators need. |
| `make clean` | Delete `target/`, `project/*/target/` and `out/`. |
| `make diff-out` | Build `main` in a throwaway worktree and diff the two `out/` trees. Use it for any change meant to be output-neutral. |
| `make fact-explorer` | Build with `--formBuilderGraph` and print this app's Fact Explorer URL. |
| `make up` / `down` / `logs` / `ps` / `rebuild` | The Docker stack. `rebuild` is the escape hatch for a stale sibling library. |

The `copy-fg`, `copy-shared-ui` and `copy-uswds` targets regenerate the vendored mirrors under
`website-static/vendor/`. Every build target runs them first, so you rarely call one by hand.

## Where things go

At the root of the repository:

```
build.sbt                       one dependency, and the mainClass for `sbt run`
Makefile                        every command above
project/                        the sbt version and the scalafmt plugin
scripts/diff-out.sh             what `make diff-out` runs
.github/workflows/ci.yml        checks out and publishes the libraries, then runs `make test` and `make ci`
package.json                    the `taxpert` file: dependency, and nothing else
fact-explorer.app.json          this app, as Fact Explorer discovers it
Dockerfile                      three stages: publish the libraries, generate the site, serve it
nginx.conf                      the runtime web server, over the generator's ./out
docker-compose.yml              the prod-like stack
docker-compose.override.yml     the dev overlay: nginx plus an `sbt ~run` watcher
```

And the app itself:

```
src/main/scala/gov/irs/benefitsenrollment/Main.scala
    the FormBuilderApp value and one call to FormBuilder.run. The whole Scala surface.

src/test/scala/gov/irs/benefitsenrollment/
    FlowSpec and EligibilitySpec.

src/main/resources/benefits-enrollment/
├── flow/           the questionnaire. index.xml names the modules, and each <page> is a directory
├── facts/          the fact dictionary, merged across files
├── locales/        this app's strings. flow_*.yaml are GENERATED from the flow, so never edit them
├── templates/      only what this app overrides. Everything else comes from the scaffold
├── scenarios/      saved fact graphs the Scenario modal offers
├── package.json    USWDS, plus the ESLint and html-validate tooling the validators use
└── website-static/ served verbatim at /resources: styles, js, img, and the vendored mirrors
```

### Flow XML

`flow/index.xml` names each module with `<module src="…"/>`, and the scaffold splices them together
before parsing. A `<page route="…">` becomes a directory in the built site, and routes must be
unique across the whole flow. Inside a page you have `<section>`, `<fg-set path="/someFact">` with a
`<question>` and an `<input type="…">`, `<fg-alert>`, `<fg-detail>`, `<fg-collection>`,
`<modal-dialog>` with `<modal-link>`, and ordinary HTML for anything that is just prose.

Authored text lives here rather than in a locale file. Every question, hint and alert heading is
extracted into `locales/flow_en.yaml` on every build.

### Facts

`facts/*.xml` hold the `<Fact path="…">` definitions: `<Writable>` for something a taxpayer answers,
`<Derived>` for something computed from other facts. Every file in the directory is loaded
alphabetically and merged into one dictionary, and on a duplicate path the last definition wins.

The facts are validated against `facts/FactDictionaryModule.rng`, and the flow against
`flow/FlowConfig.rng`. Both schemas belong to this app, so widen them when you widen the flow.

A fact path in the flow that does not resolve in the dictionary fails the build, and `FlowSpec` is
what catches it.

### Locales

`locales/en.yaml` and `locales/es.yaml` carry this app's own words, layered over the chrome strings
the scaffold ships. Lookup is app first, then the library, then the generated flow locale, so
declaring a key the scaffold also has overrides it without copying the rest.

One key per flow module lives under `all-screens.section.*`, and supplies the section headings on the
Browse All listing. A module with no heading renders as the key itself.

`locales/flow_en.yaml` and `locales/flow_es.yaml` are generated from the flow XML. Translate into
`flow_es.yaml`, whose human translations are preserved when it is re-synced. Editing `flow_en.yaml`
by hand loses the edit at the next build.

### Brand CSS

`website-static/styles/main.css` imports USWDS, then the Form Builder theme, then this app's own
`components/brand.css`. Put your overrides in `brand.css` or below the theme import, where they win
by ordinary cascade order. Do not fork a theme file to change one value.

### The workspace mounts

`templates/fragments/` holds four fragments the library ships empty and this app fills in:
`workspace-head.html` (the stylesheets and element modules), `workspace-enable.html` (the call that
turns the workspace on), `workspace-all-screens.html` (the screens toolbar), and
`taxpert-config.html` (the nav taxonomy, the determinations, the endpoints). Only these fragments
name a path inside `vendor/taxpert/`, which is what keeps the library free of any reference to a
package an app can drop.

The code those fragments call, meaning the fact-graph port and the fact paths the outcomes are
built from, lives in `website-static/js/taxpert/benefits-enrollment-graph.js`. The split is
there because labels go through Thymeleaf and are resolved per locale at build time, while
`website-static/` is served verbatim and never passes through Thymeleaf. A string written there
would be English in the Spanish build.

### Scenarios

`scenarios/` holds eight saved fact graphs, offered by name in the workspace's Scenario modal under
`--scenarioMode` (`make dev`). Each one is a route through the prototype the conversion had to keep
working:

| Scenario | What it demonstrates |
|---|---|
| Single Adult Over The Income Limit | `not-eligible.html`, a warning that still lets you continue rather than ending the flow |
| Single Adult Under The Income Limit | the other arm of the same $10,000 rule |
| Family Of Four Both Programs | four people in one collection, both programs selected |
| Pregnant Applicant Health Coverage Only | a screener that never asks income, and passes because of it |
| Roommates Who Share Meals | meal-share household of 3 over a tax household of 1, exercising `household-meals-only-names.html` |
| Applying On Behalf Of A Neighbor | nobody marked as self, and the warning correctly silent |
| Lawful Permanent Resident With A Document | the per-person citizenship follow-up, asked of exactly one member |
| One Earner With Three Jobs | all three job slots, the prototype's own cap |

**They are generated rather than hand-written, and the generator is the source.** A scenario file is the
persister's own JSON, `{path: {$type, item}}`, with `DayWrapper`, `MultEnumWrapper` (the typo is
the wire format) and `Dollar`'s two-decimal string. It is written against no schema, with nothing to
check that the paths exist. `src/test/scala/…/Scenarios.scala` builds a real graph per persona
instead, so a typo in a fact path fails at compile or save time rather than in someone's browser.

```bash
sbt "Test/runMain gov.irs.benefitsenrollment.GenerateScenarios"   # after editing Scenarios.scala
sbt test                                                          # ScenariosSpec fails if they drift
```

Keys are sorted and the collection ids are fixed, so regenerating an unchanged corpus produces no
diff. The ids are not arbitrary: `FactDictionary`'s wildcard resolution matches only RFC-4122 v1–5
UUIDs, so an id with the wrong version or variant nibble makes every `/householdMembers/*/…` path
in the file unresolvable.

`ScenariosSpec` reads the committed files back through the same `InMemoryPersister(json)` the
browser uses and asserts each one's determinations. That is what catches a scenario gone stale
against a renamed fact, which nothing else in the build would notice.

## Three rules to follow

1. **Authored text goes in the flow XML.** `locales/flow_*.yaml` are build outputs.
2. **Never hand-edit anything under `website-static/vendor/`.** Every directory in there is a
   generated mirror with exactly one writer: `make copy-uswds` for USWDS, `make copy-fg` for the
   Scala.js fact graph, `make copy-shared-ui` for taxpert, and the scaffold itself for
   `vendor/form-builder/`, which it extracts from its own jar as it generates the site.
   `make check-shared-ui` fails the build if the taxpert mirror drifts.
3. **Override rather than fork.** Change a node template by dropping a same-named file into
   `templates/nodes/`, since app templates resolve ahead of the library's. Change a chrome string by
   declaring that key in `locales/en.yaml`.

## Adding a question

1. Add the fact to `facts/`.
2. Add an `<fg-set path="/yourFact">` to the right page in `flow/`, with a `<question>` and an
   `<input type="…">`.
3. Run `make validate-xml`.
4. Add a case to `src/test/scala/gov/irs/benefitsenrollment/EligibilitySpec.scala` if it
   changes a determination.

## Extending the scaffold

Two seams, both registrations on the `FormBuilderApp` in `Main.scala` rather than edits to the
library:

- **`nodeTypes`** maps a flow element the scaffold has never heard of to a `FlowNodeParser`. Put the
  element's Thymeleaf template in `templates/nodes/`, and widen `flow/FlowConfig.rng` to allow it.
  Mirror the tag name in `customFlowTags` in `fact-explorer.app.json`, or Fact Explorer rejects it.
- **`inputTypes`** maps an `<input type="…">` value to an `InputParser`. Registering an existing name
  replaces the built-in rather than adding a second one.

Both maps merge over the built-ins, so either one can also replace something the library provides.

## Deciding where a change goes

| The change is about… | It belongs in |
|---|---|
| A question, a rule, a threshold, a word a taxpayer reads | this repository |
| How any Flow XML becomes HTML: the parser, a generator, a node template, a chrome string, the theme, the flow runtime | `../form-builder` |
| The workspace: nav, audit panel, Inspect / Outcome tracker / Watchlist | `../taxpert/packages/ui` |

A change in a library needs `sbt test publishLocal` (or `npm test`) there, and then a `make ci` in
every app built on it. A second app is what catches an assumption that only holds for the first.

## Gotchas

- **An incomplete fact has no value at all.** A derived fact over an unanswered input returns `None`
  rather than `false`. Code that collapses the two will tell a taxpayer they do not qualify when the
  honest answer is that we have not asked yet. `EligibilitySpec`'s third case is the pattern to copy.
- **`make validate-templates`** rejects HTML comments inside inline `<script>` blocks. They are legal
  in a classic script and a syntax error in a module, and nothing else in the build catches it.
- **Both RELAX NG schemas are yours.** `make validate-xml` runs the facts half and the flow half, and
  a schema that is never widened alongside the flow it describes quietly drifts out of agreement
  with it.
- **`make diff-out` needs a commit on `main`.** A freshly generated repository has everything staged
  and nothing committed, so make the first commit before expecting a diff.
- **`.github/workflows/ci.yml` checks out the libraries by name** from `your-org/…` placeholders.
  Repoint them at the real repositories before CI can pass.
- **Stop the Docker stack before building on the host.** The dev overlay mounts named volumes at
  `website-static/vendor/fact-graph` and `.../uswds-3.13.0`, and while a container holds them the
  host cannot delete those directories, so `make copy-uswds` fails with "Permission denied", taking
  `make site` and `make ci` with it. The two also share `./target` through the bind mount, so two
  sbt processes would be writing the same build state. `make down`, build, then `make up`.

## Two local deviations from the generated defaults

**`htmlvalidate.json` declares `form-dup-name` for checkbox groups.** A checkbox group shares one
`name` by design. That is how a browser submits it as a set, and it is what the scaffold's
`nodes/inputs/multi-enum.html` emits: unique `id` and `value` per option, one `name` for the group,
inside a `<fieldset>` with a `<legend>`. The rule's default `shared` list covers `radio` only. This
application is the first to use `<input type="multi-enum">` in a flow, so the config the template
inherited from the two example apps had never needed the setting.

**`facts/FactDictionaryModule.rng` allows a `<String>` placeholder.** `Placeholder.apply` in
fact-graph only requires the default to be the same CompNode class as the source, so any writable
type can carry one. The schema listed a subset that omitted `String`. An optional String field, such as a
middle name or a second address line, has no other way to be expressed, because `FgSet` derives
`isOptional` solely from the presence of a `<Placeholder>`.

## Two library fixes this app required

Neither is local to this app, and both are needed for it to work at all. Each library has two
checkouts on this machine: `~/fact-graph` and the clone at `../fact-graph` that this app and its
Docker build actually resolve, and likewise for `form-builder`. The edits are present in both,
as uncommitted working-tree changes. Commit them before relying on a fresh clone of either.

**`JSGraph.set` could not write a String fact.** In the browser every answer arrives at
`JSGraph.set(path, value)` as a raw form string, which picks its conversion from the fact
definition. Its match covered Boolean, Int, Enum, Dollar and Day, falling through to
`UnsupportedTypeError` for everything else. A String writable therefore reported "Sorry, something
went wrong" for *every* value, correct ones included. All 27 `<input type="text"/>` fields in this
flow (names, SSN, addresses, employer names, the signature) were dead. Neither example app uses a
text input in a flow, so nothing had exercised it. The fix is one `case _: StringNode => value` in
`fact-graph`'s `js/.../JSGraph.scala`, with `JSGraphSpec` pinning it. No factory call: a String
writable's constraints are `<Limit>`s on the fact, and limits are already reported by the `set`
below, exactly as `Min`/`Max` on a Dollar are.

Two neighbours of that gap are worth knowing. `MultiEnumNode` is missing from the same match but
works anyway. `fg-set.js` hands it a real `MultiEnum` object rather than a string, so Scala.js
dispatches to the inherited `Graph.set(path, WritableType)` overload instead. That overload
returns a tuple rather than a `SetReturnValue`, so a multi-enum write reports no error either way.

**A `Match` limit violation had no message.** `fg-set.js` looks up `errors.{errorName}` and falls
back to `errors.Default`, and there was no `errors.Match`, so a badly formatted ZIP said "Sorry,
something went wrong", indistinguishable from the bug above. Added to `form-builder`'s eight locale
files and to `templates/errors.html`. `fg-set.js` also appends the limit to the message so "Enter an
amount more than" reads as a sentence. For `Match`, that limit is a regular expression, so the append
is suppressed and the message stands alone.

## Known issues

These are upstream rather than local. They are recorded here because each one shaped a decision above.

**Nested `fg-collection` is unsafe in the browser runtime.** The fact graph handles arbitrary
wildcard depth (`FactDefinitionSpec` defines and resolves `/collection/*/anotherCollection/*/test`),
but four defects in `form-builder`'s `website-static/flow-runtime/js/` make a nested collection
silently write to the wrong path:

- `configureCollectionIds` uses `querySelectorAll`, which does not descend into `<template>` content.
- `makeCollectionIdPath` replaces only the first `*`, so an inner `fg-set` resolves against the *outer* item's id.
- The remove-item modal is emitted outside the `<template>` and is cloned with a duplicate id.
- Item counting uses an unscoped `this.querySelectorAll('fg-collection-item')` that counts across the nesting boundary.

This is why jobs are fixed slots. If it is fixed, the flow change is one `<fg-collection>` and the fact change
is mechanical.

**A new input type gets no client-side read or write.** `fg-set.js` keys four `switch` statements
off `inputtype` with a `console.warn` default and no extension point, so an `InputParser` registered
under a genuinely new name renders but never reads or writes its fact. TWE's `YearRangeDate` works
because it re-registers under the existing name `"date"`. Its `single-checkbox` does not, and looks
like a live latent bug. This application needs no custom input, so `customFlowTags` is `[]`.

**In `--singleQuestionPerScreen` mode the site root has no page.** `PageSplitter` renames every
emitted route when a source page holds more than one question, and `joinRoute("/", slug)` yields
`/slug`, so a multi-question page at route `/` leaves nothing at the root. Credit Assistant has the
same characteristic (six questions on its `/` page), so this is inherent to the scaffold in that
mode rather than specific to this app. It affects `make dev-one-question` only. `make dev` and
`make site` are unaffected.

**An authored `sep=" "` on `<Paste>` is silently destroyed.** `OptionConfigTrait.fromXml` trims
every attribute value along with the element's text content. The text needs it, because fact XML is
indented, but the attributes were authored exactly. A space separator therefore arrives as `""`, so
`<Paste sep=" ">` produces `JanePublic` where `<Paste>` produces `Jane Public`. The explicit
attribute is worse than no attribute, which is the opposite of what it reads as. `/householdMembers/*/fullName`
relies on the default and `DerivedTextSpec` pins the space.

**`resolveCollectionAliasPath` throws instead of returning `None`.** `FactDictionary.apply` tries a
direct path, then a wildcard, then a collection alias. The alias branch casts with an unchecked
`asInstanceOf[CollectionItemNode]`, so a path that reaches it over an ordinary collection dies with a
`ClassCastException` rather than falling through to `orNull`. Reaching it needs a collection id the
wildcard step does not recognise, and that step matches only RFC-4122 v1-5 UUIDs. `crypto.randomUUID()`
produces v4, so the browser never gets there. A hand-written id in a test will.

**A read-only per-collection-item review does not exist.** `fg-collection` is always editable, and
there is no built-in element for "repeat this markup for each item, read-only". `/review`
therefore summarises the household in aggregate, and per-person answers are reviewed by returning to
`/household`.
