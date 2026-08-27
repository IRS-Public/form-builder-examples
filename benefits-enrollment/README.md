# Benefits Enrollment

A Form Builder benefits enrollment application that combines SNAP and Medicaid applications. Identical layout to TWE and EITC Assistant.
Fact Dictionaries and Flow XML were generated using AI and should not be taken as authoritative or containing best practices; they are only meant as a demonstration of how
all of these tools work together in different domains (i.e. not just federal taxes).

Serves from `/app/benefits`.

## Where this came from

This is a conversion of a [benefits enrollment
prototype](https://github.com/usds/benefits-enrollment-prototype), a 2016 Jekyll site of 121 static
pages that kept all its state in `sessionStorage` and expressed all its logic as inline `<script>`
blocks reading `window` globals and assigning `window.location.href`.

Most of those 121 pages were duplication: `person1`…`person6` copies of the same four screens across
four directories. Here we just use `<fg-collection>` over `/householdMembers` in
`flow/household.xml`, which is why the flow is seven modules rather than eight directories of
near-identical HTML.

## Getting started

```bash
make bootstrap    # once: publish the libraries, install deps, vendor their assets
make dev          # http://localhost:3006/app/benefits/
```

Skip the local toolchain entirely with `make up`, which builds both Scala libraries in Docker,
generates the site, serves it at the same address, and leaves an `sbt ~run` watcher regenerating on
every edit. This is the only one of the three example applications with a compose stack.

The native path needs JDK 21, sbt, Node 22, and `xmllint` for the XML validators (`libxml2-utils` on
Debian or Ubuntu), plus the three library checkouts described in the
[repository README](../README.md#quickstart). Full setup instructions for the whole ecosystem are in
the [QUICKSTART.md](https://github.com/IRS-Public/taxpert/blob/main/docs/QUICKSTART.md) in the taxpert repository.

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

The Fact Graph browser bundle is the one mirror committed to git, as it is in the other two
applications here. Nothing publishes it, so without a copy in the repository this application would
have no engine in the browser until someone built fact-graph. `make copy-fg` refreshes it from a
`../../fact-graph` checkout when one is built, and prints a message and moves on when it is not.

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

**They are generated rather than hand-written** A scenario file is the
persister's own JSON, `{path: {$type, item}}`, with `DayWrapper`, `MultEnumWrapper` (the typo is
the wire format) and `Dollar`'s two-decimal string. It is written against no schema, with nothing to
check that the paths exist. `src/test/scala/…/Scenarios.scala` builds a real graph per persona
instead, so a typo in a fact path fails at compile or save time rather than in someone's browser.

```bash
sbt "Test/runMain gov.irs.benefitsenrollment.GenerateScenarios"   # after editing Scenarios.scala
sbt test                                                          # ScenariosSpec fails if they drift
```

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