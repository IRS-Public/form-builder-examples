# AGENTS.md: form-builder-examples

Four reference applications built on the Form Builder, Fact Graph, and Taxpert libraries. Nothing
here is a library, and nothing here is meant to be depended on. Each application is the thin
remainder that a library cannot supply: its Flow XML, its Fact Dictionary, its locales, its brand
CSS, and a `Main.scala` of about 40 lines. The four share no code.

[README.md](README.md) is the orientation for the repository, and each application has its own
README with its full target list. Setup and run instructions live in one place for the whole
ecosystem, the
[QUICKSTART.md](https://github.com/IRS-Public/taxpert/blob/main/docs/QUICKSTART.md) in the taxpert
repository, so do not add them here.

## Where this fits

| Repository | What it is |
|---|---|
| [fact-graph](https://github.com/IRS-Public/fact-graph) | `gov.irs::factgraph`, the rules engine. |
| [form-builder](https://github.com/IRS-Public/form-builder) | `gov.irs::form-builder`, the scaffold. Parsers, generators, node templates, chrome locales, the theme, the flow runtime, Author Mode. |
| [taxpert](https://github.com/IRS-Public/taxpert) | The optional workspace UI and its companion services. |
| [form-builder-template](https://github.com/IRS-Public/form-builder-template) | Cookiecutter that generates a new application. |
| **form-builder-examples** (here) | The reference applications: Credit Assistant (EITC), the Tax Withholding Estimator, Benefits Enrollment, and the Direct File port. |

Only Form Builder and Fact Graph are required. An application still runs without Taxpert, because
the theme and the flow runtime ship inside the form-builder jar.

## The four applications

| | `credit-assistant/` | `tax-withholding-estimator/` | `benefits-enrollment/` | `direct-file-form-builder/` |
|---|---|---|---|---|
| What it does | Screens a taxpayer for the Earned Income Tax Credit | Estimates federal income-tax withholdings | Screens a household for SNAP and Medicaid | Ports IRS Direct File's return questionnaire |
| Served at | `/app/eitc` | `/app/tax-withholding-estimator` | `/app/benefits` | `/app/direct-file` |
| Dev port | 3003 | 3000 | 3006 | 3008 |
| Resource directory | `credit-assistant` | `twe` | `benefits-enrollment` | `direct-file` |
| Languages | 8 | 2 | 1 | 1 |
| Extension points used | 3 of 5 | 5 of 5 | 2 of 5 | 2 of 5 |
| Production build | `make credit-assistant` | `make twe` | `make site` | `make site` |
| Fact Explorer id | `credit-assistant` | `twe` | `benefits-enrollment` | `direct-file` |

The resource directory is `app_id`, and it is independent of the repository directory and the URL
segment. Credit Assistant is the case where all three differ.

**Tax Withholding Estimator is the one that exercises every extension seam**, so it is the
application to check a scaffold change against. It registers a custom node type
(`fg-withholding-adjustments`), a custom input type, and a replacement for a built-in one, and it
overrides seven node templates. Benefits Enrollment sits at the other end, overriding no templates
at all, and is the one that catches a change assuming the workspace or a second language is present.

## Deciding where a change belongs

Domain content is an application's. Anything a second application would also want belongs to a
library. The five extension seams are listed in
[form-builder's ARCHITECTURE.md](https://github.com/IRS-Public/form-builder/blob/main/docs/ARCHITECTURE.md).

| The change is about | It goes in |
|---|---|
| a flow page, a fact, a locale string, brand CSS, a scenario | the application |
| how any Flow XML becomes HTML: the parser, a generator, a node template, a chrome string, the theme, the flow runtime, Author Mode | `form-builder` |
| the workspace: nav, audit panel, tool panels, Fact Explorer, the assistant service | `taxpert` |

Adding an application's name, URL segment, or storage prefix to a library is the signal that the
value belongs in that application's `FormBuilderApp` in `Main.scala` instead. In the other
direction, a fix made in one application here that the other three would also want is usually a
library change that all four should then inherit.

## Layout

Each application owns its own `build.sbt`, `Makefile`, `package.json`, `fact-explorer.app.json`, and
`.scalafmt.conf`, and each builds without the others.

| Path | What it is |
|---|---|
| `Makefile` | Fans every command out over the applications, discovered by globbing `*/src/main/resources/*/flow` rather than from a hardcoded list |
| `<app>/src/main/scala/.../Main.scala` | The `FormBuilderApp` and the entry point |
| `<app>/src/main/resources/<app_id>/flow/` | Flow XML and this application's own `FlowConfig.rng` |
| `<app>/src/main/resources/<app_id>/facts/` | The Fact Dictionary and its `FactDictionaryModule.rng` |
| `<app>/src/main/resources/<app_id>/locales/` | Authored `{lang}.yaml`, plus the generated `flow_{lang}.yaml` |
| `<app>/src/main/resources/<app_id>/templates/` | Node template overrides and the workspace mount fragments |
| `<app>/src/main/resources/<app_id>/website-static/` | Brand CSS, application JavaScript, images, and the vendored mirrors |
| `<app>/docs/` | Application documentation. TWE carries the ADRs the whole ecosystem descends from |
| `form-builder-apps.json` | Sets Fact Explorer's default application and the order the four appear in. The descriptor Fact Explorer's registry build globs is each application's own `fact-explorer.app.json` |

## Commands

Every target at the root takes `APPS=` to narrow it to a subset, as in
`make ci APPS=credit-assistant`. The same target names exist inside each application directory and
act on that one.

| Command | What it does |
|---|---|
| `make list` | Print the applications the other targets will act on, and the library paths |
| `make bootstrap` | First-run setup: publish both Scala libraries once, then install and vendor per application |
| `make run-all-local` | One `make dev` per application, prefixed output, Ctrl-C stops all |
| `make run-all-docker` | The Docker counterpart, reaching the same addresses |
| `make ci` | Per application: build, `check-shared-ui`, and validate XML, HTML, JavaScript, and Scala |
| `make test`, `make site`, `make format`, `make clean` | Per application, in turn |
| `make link-taxpert TAXPERT_UI=...` | Install the workspace package from a taxpert checkout kept elsewhere |

`make bootstrap` publishes the libraries once for all four rather than once each. Both library
paths default to a sibling checkout. Neither library is on a remote registry, so `publishLocal` from
a checkout is the only way either reaches an application here.

Inside an application, `make dev` passes `--auditMode` and the flags that application needs. The
extra dev targets are not uniform. Credit Assistant has `make dev-ai`, which additionally passes
`--aiScenarioGeneration --aiFactExplanation` to reveal the two AI chat features, and neither of the
others wires those up. Credit Assistant, Benefits Enrollment and Direct File have `make dev-author`, and TWE does
not. Check the application's own Makefile rather than assuming a target exists in all four.

## Gotchas

- **`website-static/vendor/` is generated, gitignored, and has exactly one writer.** Never commit or
  hand-edit anything under it. `copy-fg` writes the Fact Graph bundle and `copy-shared-ui` mirrors
  `taxpert/packages/ui/src`. Benefits Enrollment additionally has `copy-uswds`, because it is the
  one application here that vendors the design system from npm. `make check-shared-ui`, part of
  `make ci`, fails the build if the taxpert mirror has drifted.
- **Shared UI must not be reimplemented here.** A change to the audit panel, the tool panels, the
  global nav, or the all-screens toolbar belongs in `taxpert/packages/ui/`, followed by
  `make copy-shared-ui`. An application's own `website-static/` is for application-specific
  behavior only.
- **A change to `form-builder` reaches nothing until it is republished.** Run `sbt test
  publishLocal` there, then `make ci` in **every** application here. The applications after the
  first are what catch an assumption that only holds for the first — and Direct File, which brings a
  fact dictionary and a flow it did not author, catches the most.
- **All four commit their `factgraph-3.1.0.js`.** `make copy-fg` prints a message and moves on when
  it finds no Fact Graph build, so a fresh clone has a working engine in the browser with no
  fact-graph checkout. The Scala side is the part that still needs one.
- **Scala.js output is not byte-reproducible.** `factgraph-3.1.0.js` can change after a
  `make publish` in fact-graph even when no source did. Those diffs do not need to be committed.
- **`locales/flow_*.yaml` is generated on every build.** Authored text lives in the flow XML, and a
  hand edit to the generated file is lost.
- **`facts/*.xml` are merged in sorted filename order, and a duplicate `<Fact path="...">` is
  last-wins.** Splitting or renaming a facts file can therefore change which definition survives.
- **Each application owns its own RELAX NG schemas**, copied from form-builder's seeds. An
  application that registers a custom node type has to widen its own grammar, which is why TWE's
  `FlowConfig.rng` and Credit Assistant's differ. Keep `make validate-xml` passing against them.
- **The Dockerfiles are the same build logic four times.** What differs is a four-line `ARG` block,
  the port, and the startup banner. A build change should land in all four or in none.
- **The dev server serves a directory of static HTML.** There is no hot module reload. `sbt ~run`
  regenerates the site on an edit, and the browser still has to be refreshed.
