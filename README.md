# Form Builder Examples

Reference applications built on [Form Builder](https://github.com/IRS-Public/form-builder), [Fact Graph]
(https://github.com/IRS-Public/fact-graph), and [Taxpert](https://github.com/IRS-Public/taxpert). 

If you are interested in building your own Form 
Builder application similar to these, 
check out [Form Builder Template](https://github.com/IRS-Public/form-builder-template). To understand the difference between Taxpert, Form Builder and the Fact Graph, see [this doc](https://github.com/IRS-Public/taxpert/blob/main/docs/adr/taxpert-form-builder-fact-graph.md).

**This repository is demonstration code.** Nothing here is a library nor meant to be
depended on. The reusable parts live in three other repositories, and these applications are
what they look like in use. 
in one repository for convenience. 

## Where this fits

| Component                                                                                   | What it is                                                                                                                                                                                                                                                                                                                                          |
|---------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`fact-graph`](https://github.com/IRS-Public/fact-graph)                                    | `gov.irs::factgraph`, the rules engine. Cross-compiled: a JVM jar this library builds against, and a Scala.js bundle the browser runs.                                                                                                                                                                                                              |
| `form-builder`                                                                              | `gov.irs::form-builder`, presentation generator, including parsers, Thymeleaf engine, node templates, locales, RELAX NG schemas, theme, and flow runtime.                                                                                                                                                                                 |
| [`taxpert`](https://github.com/IRS-Public/taxpert)                                          | The workspace UI (`taxpert` on npm, in that repo's `packages/ui`): global nav, audit panel, tool panels. Optional. An application can ship without it. That repo's `packages/fact-explorer` is a React and Vite SPA that visualizes any Form Builder app's flow and facts as a graph, reading the JSON this library emits under `--formBuilderGraph`. |
| [`form-builder-template`](https://github.com/IRS-Public/form-builder-template)              | A cookiecutter that generates a new Form Builder app, with optional extensions like Taxpert.                                                                                                                                                                                                                                                        |
| [`form-builder-examples`](https://github.com/IRS-Public/form-builder-examples) | Reference applications that leverage the three core libraries.                                                                                                                                                                                                                                                                                      |

Only Form Builder and Fact Graph are required. An application still runs without Taxpert, because the theme
and the questionnaire runtime come from Form Builder's jar. Taxpert adds the tooling that lets you
inspect a running application's business logic.

That layout is what the relative paths in each Makefile and `package.json` resolve against:
`../fact-graph`, `../form-builder` and `../taxpert/packages/ui`, all relative to the application
directory. The three clones are gitignored here.

## Quickstart

None of the three core libraries (Fact Graph, Form Builder, Taxpert) are on a public artifact registry (Maven, Github 
Packages, etc.), so all three come from checkouts. Clone them into the root of this repository, beside the application directories:

```bash
git clone https://github.com/IRS-Public/fact-graph
git clone https://github.com/IRS-Public/form-builder
git clone https://github.com/IRS-Public/taxpert (optional, if you want to run taxpert)
```
`cd` to an application you are interested in and run `make up` (to run everything in Docker) or `make bootstrap` + 
`make dev`.

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



| | [`credit-assistant/`](credit-assistant/README.md) | [`tax-withholding-estimator/`](tax-withholding-estimator/README.md) | [`benefits-enrollment/`](benefits-enrollment/README.md)        |
|---|---|---------------------------------------------------------------------|----------------------------------------------------------------|
| What it does | Screens a taxpayer for the Earned Income Tax Credit | Estimates federal income-tax withholdings                           | Screens a household for SNAP and Medicaid                      |
| Served at | `/app/eitc` | `/app/tax-withholding-estimator`                                    | `/app/benefits`                                                |
| Dev port | 3003 | 3000                                                                | 3006                                                           |
| Languages | 8 | 2 (English, Spanish)                                                | 1 (English)                                                    |
| Extension points used | 3 of 5 | 5 of 5                                                              | 2 of 5                                                         |
| Production build target | `make credit-assistant` | `make twe`                                                          | `make site`                                                    |

The three directories share no code. Each has its own `build.sbt`, `package.json`,
`Makefile`, and `fact-explorer.app.json`, and each can be built without the others. See each application's README for its full target list.

## Inspecting a running application

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
`--aiScenarioGeneration --aiFactExplanation`, which reveal the two AI chat features.
Neither TWE nor Benefits Enrollment wires those features up in their default state.


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
