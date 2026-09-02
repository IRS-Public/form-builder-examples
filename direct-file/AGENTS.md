# AGENTS.md: direct-file

A port of [IRS Direct File](https://github.com/IRS-Public/direct-file)'s `df-client-app`, expressed
as configuration over `gov.irs::form-builder`. Flow XML describes the questions, a fact dictionary
describes the tax facts behind them, and the scaffold turns the two into plain HTML under `./out`.
Serves from `/app/direct-file` on port 3008.

The repository-wide rules in [`../AGENTS.md`](../AGENTS.md) hold here too. This file covers only what
is different about this application. [README.md](README.md) is the full orientation — every target,
every directory, the extension seams, the requirements — and this file does not repeat it.

| For | Read |
|---|---|
| Everything about this application | [README.md](README.md) |
| The transpiler: its stages, where each runs, what is committed | [`codemod/README.md`](codemod/README.md) |
| What was ported from Direct File, what was excluded, and why | [`docs/FLOW_TRANSPILATION.md`](docs/FLOW_TRANSPILATION.md) |

## The flow is generated, and that changes everything

The other three applications in this repository are authored. This one is a **port**: its Flow XML
and `facts/flowGates.xml` come out of the transpiler in [`codemod/`](codemod/README.md), which reads
a Direct File checkout and emits Form Builder XML.

So the instinct that is right in every other application — open the page, fix the wording, done — is
wrong here. A hand edit under `flow/` survives until the next `make transpile` and then vanishes, and
nothing warns you.

**To change a page, change the transpiler.**

```bash
make transpile          # regenerate flow/ and facts/flowGates.xml
make transpile-verify   # prove the port still matches upstream
```

Both need a Direct File checkout. `DF_CLIENT_APP` says where it is; the default is in the `Makefile`.
Nothing here ever writes to that checkout — if a change seems to need that, it belongs upstream.

### Generated files: one writer each

An edit to any of these is lost on the next build, and a commit of one is a change that reverts
itself later in someone else's PR.

| Path | Written by |
|---|---|
| `flow/**`, `facts/flowGates.xml` | `make transpile` |
| `locales/flow_en.yaml` | every build, from the flow |
| `locales/flow_es.yaml` | `make transpile-es`, seeded from Direct File's own `es.yaml` |
| `scenarios/**` | `make export-scenarios` |
| `website-static/vendor/**` | `copy-fg`, `copy-shared-ui`, `copy-uswds`, and the scaffold's own jar |
| `codemod/*.json`, `codemod/*coverage.md` | the transpiler stages |
| `out/` | `make site` |

The 36 fact modules that are **not** `flowGates.xml` are the opposite case: Direct File's dictionary
carried over byte-for-byte, and that correspondence is what makes the copy auditable. Change one only
for a real tax-logic reason, and change it upstream too.

## What is authored here

Small, and worth knowing so you can tell it from the generated majority:

- `src/main/scala/gov/irs/directfile/Main.scala` — the `FormBuilderApp`. The whole Scala surface is
  this file plus `inputs/`.
- `src/main/scala/gov/irs/directfile/inputs/` — four parsers behind eight input types. Each type name
  selects **three** things that must agree: the parser, `templates/nodes/inputs/{name}.html`, and the
  handlers in `website-static/js/inputs/`.
- `locales/en.yaml`, `locales/es.yaml` — this application's own words. Not the generated `flow_*.yaml`.
- `templates/fragments/` — the four workspace mounts, plus a step-indicator override.
- `website-static/styles/`, `website-static/js/` — brand CSS and this application's browser code.
- `codemod/*.ts` — the transpiler itself.
- `facts/FactDictionaryModule.rng`, `flow/FlowConfig.rng` — both schemas are this application's.
  Widen them when you widen the flow.

## Deciding where a change goes

| The change is about | It belongs in |
|---|---|
| A page, a question, a word a taxpayer reads | `codemod/`, then `make transpile` |
| Which taxpayers see a screen | `codemod/gates.ts`, then `make transpile-verify` |
| The Spanish | Direct File's `es.yaml` upstream — this port translates nothing itself |
| A fact, a rule, a threshold | `facts/`, and upstream Direct File if it is real tax logic |
| Brand CSS, this application's own JS, the workspace mounts | `website-static/`, `templates/fragments/` |
| How any Flow XML becomes HTML: parser, generator, node template, chrome string, theme, flow runtime | `../../form-builder` |
| The workspace: nav, audit panel, Inspect, Outcome tracker, Watchlist | `../../taxpert/packages/ui` |

A change in either library needs `sbt test publishLocal` (or `npm test`) there, then `make ci` in
**every** application in this repository. Tax Withholding Estimator exercises all five extension
seams and Benefits Enrollment has no workspace; between them they catch what Direct File alone will
not.

## The five gates

Run the one that matches what you touched. Do not report a change as done on a green build alone —
this application has whole classes of failure `make ci` cannot see.

| Gate | Command | Answers |
|---|---|---|
| Build | `make ci` | Does the site generate, validate and lint? |
| Dictionary | `make test` | Does the dictionary still compute Direct File's arithmetic, and does the flow still have the shape the transpiler promises? |
| Parity | `make transpile-verify` | Does each screen show to exactly the taxpayers Direct File shows it to? |
| Translation | `make transpile-es` | Does every `flow_en.yaml` key have Direct File's Spanish under it? Needs `make site` first. |
| Browser | `make site && make smoke` | Does the generated site actually run? |

**`make smoke` is the only gate that opens a browser, and it is not optional for a runtime change.**
The parity gates evaluate conditions in-engine and never render a page, so they are blind to a fact
path the browser cannot write, an input type that fails to register, or a module that throws on
import. All three have happened here, and none moved a single number in the parity run.

## Gotchas

The ones that specifically catch an agent. [README.md](README.md#gotchas) has the rest.

- **`make format` deliberately leaves the XML alone here**, unlike the other three applications.
  `xmllint --format` would rewrite all 36 of Direct File's fact modules and destroy the byte-for-byte
  correspondence; `flow/` is generated, so formatting it is undone by the next `make transpile`. Do
  not "fix" this.
- **Two page grains, both real.** Every target except `dev-topic-pages` and `dev-author` passes
  `--singleQuestionPerScreen`, splitting 138 topic pages into 378. When a question appears on the
  wrong page, look at `make dev-topic-pages` — the un-split grain is the one the XML is written in.
  Author Mode is un-split for the same reason, so the Docker stack serves the un-split flow.
- **An incomplete fact has no value at all.** A derived fact over an unanswered input returns `None`,
  not `false`. Collapsing the two tells a taxpayer they do not qualify when the honest answer is that
  we have not asked yet. In the browser, read `fact.complete` before `fact.get` — `Result.get` throws.
- **`website-static/` never passes through Thymeleaf.** It is served verbatim, so a user-facing string
  written there is English in the Spanish build. Labels belong in a template or a locale file.
- **`make transpile` refuses to write** unless all 25 `all-screens.section.*` locale keys are present.
  Adding a flow module means adding its key.
- **`make ci` fails intermittently on a shared `target/`.** The dev overlay bind-mounts this
  repository and runs `sbt ~run` inside it, so a container build and a host build share one
  `target/scala-3.7.2/classes`. Run `make down` before a host build; `build.sbt` carries the diagnosis.
- **`make diff-out` needs a commit on `main`** — it builds `main` in a throwaway worktree to diff
  against. Use it for any change meant to be output-neutral.
- **Run `make unregister-explorer` before moving or deleting this repository.** `make up` writes a
  bind mount for it into the taxpert stack's Fact Explorer.
