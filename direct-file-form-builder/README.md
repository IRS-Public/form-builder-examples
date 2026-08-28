# Direct File

A multi-language static questionnaire, built as a Form Builder application. Flow XML describes the
questions, a fact dictionary describes the tax facts behind them, and `gov.irs::form-builder` turns
the two into a site: every page, in every language, as plain HTML under `./out`.

This repository holds the domain. The flow, the facts, the locales, the brand styling, and a
`Main.scala` of about 40 lines. Everything else comes from the libraries below.

Serves from `/app/direct-file`.

## What this is built on

| Library | Where | What it gives you |
|---|---|---|
| `gov.irs::factgraph` | `../../fact-graph` | The fact evaluation engine, as a JVM jar and a Scala.js browser bundle. |
| `gov.irs::form-builder` | `../../form-builder` | The scaffold: flow parser, site generators, Thymeleaf engine, node templates, chrome locales, the theme and the browser flow runtime. |
| `taxpert` | `../../taxpert/packages/ui` | The workspace laid over the running app: global nav, audit panel, and the Inspect / Outcome tracker / Watchlist tool panels. Optional, and this app was generated with it. |

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
└── direct-file-form-builder/
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
make up           # http://localhost:3008/app/direct-file/
```

That is the whole of it — no JDK, no sbt, no node. It builds the sibling libraries, generates the
site, serves it, and leaves an `sbt ~run` watcher regenerating on every edit. Three surfaces come
up together:

| | Where | Served by |
|---|---|---|
| The flow | `http://localhost:3008/app/direct-file/` | this stack's nginx |
| Browse All | `http://localhost:3008/app/direct-file/all-screens/` | this stack's nginx |
| Author Mode | `http://localhost:3008/app/direct-file/author/` | this stack, API on `127.0.0.1:3009` |
| Fact Explorer | `http://localhost:5180/fact-explorer/direct-file` | the **taxpert** stack |

Author Mode's API writes to `flow/*.xml` and `facts/*.xml` in this working tree, which is why it is
published on `127.0.0.1` rather than on every interface. The watcher regenerates the site from those
edits, so a save in the browser turns into a changed page a moment later.

Fact Explorer is the one surface that is not this project's. It holds every application at once, so
there is one instance beside them all rather than one per app. `make up` writes a bind mount for
this repository into `../../taxpert/docker-compose.apps.d/` and starts it —
see `scripts/register-with-taxpert.sh`, and `make unregister-explorer` before you move or delete
this repo. (A symlink into `taxpert/apps/` would not work here: a bind mount carries the link rather
than its target, so the app would silently fail to appear.)

To run it natively instead:

```bash
make bootstrap    # once: publish the libraries, install deps, vendor their assets
make dev          # same URL, same flags, minus Author Mode — use `make dev-author` for that
```

`make help` lists every target. The ones you will use:

| Target | What it does |
|---|---|
| `make dev` | Dev server with the developer surfaces this app was generated with, watching for changes. |
| `make dev-author` | The same, plus Author Mode: edit flow text and fact values from the browser, backed by a local API on port 3009. |
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
| `make register-explorer` / `unregister-explorer` | Add or remove this app's mount in the taxpert stack's Fact Explorer. `up` runs the first for you. |

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
docker-compose.override.yml     the dev overlay: nginx plus an `sbt ~run` watcher with Author Mode
scripts/register-with-taxpert.sh  what `make up` runs to mount this repo into Fact Explorer
```

And the app itself:

```
src/main/scala/gov/irs/directfile/Main.scala
    the FormBuilderApp value and one call to FormBuilder.run. The whole Scala surface.

src/test/scala/gov/irs/directfile/
    FlowSpec and EligibilitySpec.

src/main/resources/direct-file/
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
built from, lives in `website-static/js/taxpert/direct-file-graph.js`. The split is
there because labels go through Thymeleaf and are resolved per locale at build time, while
`website-static/` is served verbatim and never passes through Thymeleaf. A string written there
would be English in the Spanish build.

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
4. Add a case to `src/test/scala/gov/irs/directfile/EligibilitySpec.scala` if it
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
| How any Flow XML becomes HTML: the parser, a generator, a node template, a chrome string, the theme, the flow runtime | `../../form-builder` |
| The workspace: nav, audit panel, Inspect / Outcome tracker / Watchlist | `../../taxpert/packages/ui` |

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
