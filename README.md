# Form Builder Examples

Reference applications built on [Form Builder](https://github.com/IRS-Public/form-builder), kept
in one repository for convenience. 

**This repository is demonstration code.** Nothing here is a library nor meant to be
depended on. The reusable parts live in three other repositories, and these applications are
what they look like in use.

| | [`credit-assistant/`](credit-assistant/README.md) | [`tax-withholding-estimator/`](tax-withholding-estimator/README.md) | [`benefits-enrollment/`](benefits-enrollment/README.md)        |
|---|---|---|----------------------------------------------------------------|
| What it does | Screens a taxpayer for the Earned Income Tax Credit | Estimates federal income-tax withholding | Screens a household for SNAP and Medicaid                      |
| Served at | `/app/eitc` | `/app/tax-withholding-estimator` | `/app/benefits`                                                |
| Dev port | 3003 | 3000 | 3006                                                           |
| Languages | 8 | 2 (English, Spanish) | 1 (English)                                                    |
| Scala source | `Main.scala` only | `Main.scala` plus three extension registrations | `Main.scala` only                                              |
| Extension points used | 3 of 5 | 5 of 5 | 2 of 5                                                         |
| Production build target | `make credit-assistant` | `make twe` | `make site`                                                    |
| Read it for | The smaller introduction to the library | How far an application can customize the generated site | A non-tax use case of the Fact Graph, Form-Builder and Taxpert |

The three directories share no code. Each has its own `build.sbt`, `package.json`,
`Makefile`, and `fact-explorer.app.json`, and each can be built without the others.

## Where this fits

| Component                                                                                        | What it is                                                                                                                                                                                                                                                                                                                                          |
|--------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`fact-graph`](https://github.com/IRS-Public/fact-graph)                                         | `gov.irs::factgraph`, the rules engine. Cross-compiled: a JVM jar this library builds against, and a Scala.js bundle the browser runs.                                                                                                                                                                                                              |
| `form-builder`                                                                                   | `gov.irs::form-builder`, presentation generator, including parsers, Thymeleaf engine, node templates, locales, RELAX NG schemas, theme, and flow runtime.                                                                                                                                                                                 |
| [`taxpert`](https://github.com/IRS-Public/taxpert)                                               | The workspace UI (`taxpert` on npm, in that repo's `packages/ui`): global nav, audit panel, tool panels. Optional. An application can ship without it. That repo's `packages/fact-explorer` is a React and Vite SPA that visualizes any Form Builder app's flow and facts as a graph, reading the JSON this library emits under `--formBuilderGraph`. |
| [`form-builder-template`](https://github.com/IRS-Public/form-builder-template)                   | A cookiecutter that generates a new Form Builder app, with optional extensions like Taxpert.                                                                                                                                                                                                                                                        |
| [`**form-builder-examples** (here)`](https://github.com/IRS-Public/form-builder-examples) | Reference applications that leverage the three core libraries.                                                                                                                                                                                                                                                                                      |

Only Form Builder and Fact Graph are required. An application still runs with no Taxpert installed, because the theme
and the questionnaire runtime come from Form Builder's jar. Taxpert adds the tooling that lets you
inspect a running application's business logic

## Getting a build to run

None of the three libraries are on a public artifact registry (Maven, Github Packages, etc.), so all three come from 
checkouts.
Clone them into the root of this repository, beside the two application directories:

```bash
git clone https://github.com/IRS-Public/fact-graph
git clone https://github.com/IRS-Public/form-builder
git clone https://github.com/IRS-Public/taxpert (optional, if you want to run taxpert)
```

That layout is what the relative paths in each Makefile and `package.json` resolve against:
`../fact-graph`, `../form-builder` and `../taxpert/packages/ui`, all relative to the application
directory. The three clones are gitignored here.

In any application directory, run:

```bash
make bootstrap  # once: publish the two Scala libraries, install the npm dependencies, vendor the assets
make dev       # build and serve, watching for changes locally
```
or
```bash
make bootstrap  
make up       # run everything in docker
```

`make bootstrap` runs `sbt compile fastOptJS publishLocal` in fact-graph and `sbt publishLocal` in
form-builder, which lands both in `~/.ivy2/local`.  The Ivy cache is first in sbt's resolver chain, so
neither `build.sbt` declares a resolver or credentials. It then runs `npm install`, which resolves
`taxpert` from its checkout (if installed), and vendors the Fact Graph browser bundle and the Taxpert mirror into
`website-static/vendor/`.

A Taxpert checkout kept somewhere other than the repository root can be installed from where it is,
without editing `package.json`:

```bash
make link-taxpert TAXPERT_UI=/path/to/taxpert/packages/ui
```

`make ci-setup` accepts the same variable, and installs only what the build and the validators need.

Fact Graph is optional if you are only working on templates, locales, or CSS: `make copy-fg` prints
a message and moves on when it finds no build at `../fact-graph/js/target/`, and each application's
committed browser bundle is used instead.

Other commands

```bash
make test       # ScalaTest plus scalafmt check
make ci         # the full build-and-validate pass
make help       # every documented target
```

The three Makefiles are close but not identical. `make site` is the app-agnostic alias for the
production build in all three, and it is Benefits Enrollment's only production build target. Unlike
the other two, Benefits Enrollment has no app-named alias (`make credit-assistant`, `make twe`). Credit Assistant
additionally has `make dev-ai`, `make dev-one-question` and `make dev-author`. TWE additionally has
`make validate-uswds`. Benefits Enrollment additionally has `make dev-one-question` and
`make dev-author`. See each application's README for its full target list.

## Seeing inside a running application

Fact Explorer, in the Taxpert repository, discovers applications by scanning a directory one level
deep for `fact-explorer.app.json` descriptors. One sits at the root of each application here, so
pointing the scan at this repository finds all three:

```bash
cd /path/to/taxpert
FORM_BUILDER_APPS_DIR=/path/to/form-builder-examples \
  npm run build-registry --workspace packages/fact-explorer
```

The workspace UI in the applications themselves is switched on by a build flag. `make dev` already
passes `--auditMode` in all three. In credit-assistant, `make dev-ai` also passes
`--aiScenarioGeneration --aiFactExplanation`, which reveal the two AI features in the audit panel.
Neither TWE nor Benefits Enrollment wires those features up in their default state.

## Docker

Each application carries a `Dockerfile` and an `nginx.conf` that build the site with sbt and serve
`./out` with nginx, in three stages: one publishes fact-graph and form-builder into the image's own
Ivy cache, one generates the site, and one serves it.

The build context is the application's own directory. The three libraries are separate repositories
rather than subdirectories of this one, so each arrives as a named additional build context:

```bash
cd credit-assistant
docker build \
  --build-context fact_graph=../fact-graph \
  --build-context form-builder=../form-builder \
  --build-context taxpert=../taxpert/packages/ui \
  -t credit-assistant .
```

The same three flags build `tax-withholding-estimator` and `benefits-enrollment`. Nothing is
authenticated and no secret is mounted, as the libraries are built from the checkouts you already have.


## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

This codebase is dedicated to the public domain under the [Creative Commons Zero v1.0 Universal](LICENSE.md) license (CC0 1.0).

## Legal Disclaimer: Public Repository Access

> This repository contains draft and under-development source code. It is made available to the public solely for transparency, collaboration, and research purposes.
>
> **No Endorsement or Warranty**
>
> IRS does not endorse, maintain, or guarantee the accuracy, completeness, or functionality of the code in this repository. The IRS assumes no responsibility or liability for any use of the code by external parties, including individuals, developers, or organizations. This includes, but is not limited to, any tax consequences, computation errors, data loss, or other outcomes resulting from the use or modification of this code.
>
> Use of the code in this repository is at your own risk. This repository is not intended for production use or public consumption as a finalized product.
> 
> Artificial Intelligence was used in generating portions of this codebase.
