# Form Builder Examples

Reference applications built on [Form Builder](https://github.com/IRS-Public/form-builder),
[Fact Graph](https://github.com/IRS-Public/fact-graph), and
[Taxpert](https://github.com/IRS-Public/taxpert).

If you are interested in building your own Form Builder application similar to these, check out
[Form Builder Template](https://github.com/IRS-Public/form-builder-template). To understand the
difference between Taxpert, Form Builder and the Fact Graph, see
[this doc](https://github.com/IRS-Public/taxpert/blob/main/docs/adr/taxpert-form-builder-fact-graph.md).

**This repository is demonstration code.** Nothing here is a library, and nothing here is meant to be
depended on. The reusable parts live in three other repositories, and these applications are what
they look like in use, collected here for convenience.

## Quickstart
```bash
cd ~
git clone https://github.com/IRS-Public/fact-graph
git clone https://github.com/IRS-Public/form-builder
git clone https://github.com/IRS-Public/taxpert          
```
### Docker (recommended)
`make run-all-docker` is the single command to run everything in Docker. It will take a few minutes to pull all the 
images and spin things up. Taxpert's docker stack will be initialized automatically as well.

### Locally (with only Taxpert's Experience Explorer)

`make bootstrap` publishes the libraries once for all four applications rather than once per
application, then runs each application's `npm install` and regenerates its vendored mirrors. Every
other target is the per-application one, run in turn. `make link-taxpert TAXPERT_UI=...` works from
here as well as from an application directory, for a Taxpert checkout kept somewhere other than
beside this repository. The
[QUICKSTART.md](https://github.com/IRS-Public/taxpert/blob/main/docs/QUICKSTART.md#the-native-path) has
what each of those does.

```bash
make bootstrap
make run-all-local # once: publish the libraries, install npm deps, vendor the assets
```
`make run-all-local` initiates a `make dev` per application and prints each one's address before the sbt logs begin. Every application fixes its own port and URL prefix, so the four run side by side with
nothing to coordinate. Output is prefixed with the application name, and Ctrl-C stops all of them.

Running locally without the Taxpert Docker stack will allow you to view Experience Explorer only. Fact Explorer, 
Author Mode, and AI services will not be available.  

### Locally (with all of Taxpert)
```bash
cd path/to/taxpert
make up
cd path/to/form-builder-examples
make bootstrap
make run-all-local
```

#### One application only

If you only want to run one application locally:

```bash
cd credit-assistant
make bootstrap    
make dev          # http://localhost:3003/app/eitc/
```

`make up` in any application does the same thing in Docker, without a local toolchain. It builds both Scala
libraries inside the image, generates the site, serves it through nginx, and leaves an `sbt ~run`
watcher regenerating it as you edit.

All four applications share one Docker layout: the same `Dockerfile`, the same pair of compose
files, and the same `up` / `down` / `logs` / `ps` / `rebuild` targets. The build logic is identical
in all four. What differs is a four-line `ARG` block naming the application's directory, its
resource directory, its generator flags and whether it vendors USWDS from npm, plus the port and the
startup banner, so `diff` between any two shows only those.


| Application | Address |
|---|---|
| credit-assistant | `http://localhost:3003/app/eitc/` |
| tax-withholding-estimator | `http://localhost:3000/app/tax-withholding-estimator/` |
| benefits-enrollment | `http://localhost:3006/app/benefits/` |
| direct-file | `http://localhost:3008/app/direct-file/` |

Use `make run-all-docker APPS="credit-assistant benefits-enrollment"` to start a subset.


| | [`credit-assistant/`](credit-assistant/README.md) | [`tax-withholding-estimator/`](tax-withholding-estimator/README.md) | [`benefits-enrollment/`](benefits-enrollment/README.md) | [`direct-file/`](direct-file/README.md) |
|---|---|---|---|---|
| What it does | Screens a taxpayer for the Earned Income Tax Credit | Estimates federal income-tax withholdings | Screens a household for SNAP and Medicaid | Ports IRS Direct File's return questionnaire (no submission) |
| Served at | `/app/eitc` | `/app/tax-withholding-estimator` | `/app/benefits` | `/app/direct-file` |
| Dev port | 3003 | 3000 | 3006 | 3008 |
| Languages | 8 | 2 (English, Spanish) | 1 (English) | 2 (English, Spanish) |
| Extension points used | 3 of 5 | 5 of 5 | 2 of 5 | 2 of 5 |
| Production build target | `make credit-assistant` | `make twe` | `make site` | `make site` |
| Fact Explorer id | `credit-assistant` | `twe` | `benefits-enrollment` | `direct-file` |
| Docker | `make up` | `make up` | `make up` | `make up` |

The four directories share no code. Each has its own `build.sbt`, `package.json`,
`Makefile`, and `fact-explorer.app.json`, and each can be built without the others. See each application's README for its full target list.



## Inspecting a running application

Fact Explorer, in the Taxpert repository, discovers applications by scanning a directory one level
deep for `fact-explorer.app.json` descriptors. One sits at the root of each application here, so
pointing the scan at this repository finds all four:

```bash
cd /path/to/taxpert
FORM_BUILDER_APPS_DIR=/path/to/form-builder-examples \
  npm run build-registry --workspace packages/fact-explorer
```

Running it from there, in Docker or natively, is covered in the
[QUICKSTART.md](https://github.com/IRS-Public/taxpert/blob/main/docs/QUICKSTART.md#how-fact-explorer-finds-an-application).

The workspace UI in the applications themselves is switched on by a build flag. `make dev` already
passes `--auditMode` in all four. The two AI chat features need
`--aiScenarioGeneration --aiFactExplanation` as well: credit-assistant passes them from `make dev-ai`,
direct-file passes them from every dev target, and the other two wire them up nowhere.

## Where this fits

| Component                                                                    | What it is                                                                                                                                                                                                                                                                                                                                          |
|------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`fact-graph`](https://github.com/IRS-Public/fact-graph)                     | `gov.irs::factgraph`, the rules engine. Cross-compiled: a JVM jar this library builds against, and a Scala.js bundle the browser runs.                                                                                                                                                                                                              |
| [`form-builder`](https://github.com/IRS-Public/form-builder)                 | `gov.irs::form-builder`, presentation generator, including parsers, Thymeleaf engine, node templates, locales, RELAX NG schemas, theme, and flow runtime.                                                                                                                                                                                 |
| [`taxpert`](https://github.com/IRS-Public/taxpert)                           | The workspace UI (`taxpert` on npm, in that repo's `packages/ui`): global nav, audit panel, tool panels. Optional. An application can ship without it. That repo's `packages/fact-explorer` is a React and Vite SPA that visualizes any Form Builder app's flow and facts as a graph, reading the JSON this library emits under `--formBuilderGraph`. |
| [`form-builder-template`](https://github.com/IRS-Public/form-builder-template) | A cookiecutter that generates a new Form Builder app, with optional extensions like Taxpert.                                                                                                                                                                                                                                                        |
| `form-builder-examples` | Reference applications that leverage the three core libraries.                                                                                                                                                                                                                                                                                      |

Only Form Builder and Fact Graph are required. An application still runs without Taxpert, because the theme
and the questionnaire runtime come from Form Builder's jar. Taxpert adds the tooling that lets you
inspect a running application's business logic.



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
