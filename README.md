# Form Builder reference applications

Two working applications built on [Form Builder](https://github.com/IRS-Public/form-builder), kept in
one repository so the library has something real to be read against. Each one is a static site: the
build reads Flow XML and a Fact Dictionary and writes HTML, CSS and a small amount of JavaScript.
There is no database, no session store, and no application server at runtime.

**This repository is demonstration code.** Nothing here is a library, and nothing here is meant to be
depended on. The reusable parts live in three other repositories, and these two applications are what
they look like in use.

| | [`credit-assistant/`](credit-assistant/README.md) | [`tax-withholding-estimator/`](tax-withholding-estimator/README.md) |
|---|---|---|
| What it does | Screens a taxpayer for the Earned Income Tax Credit | Estimates federal income-tax withholding |
| Served at | `/app/eitc` | `/app/tax-withholding-estimator` |
| Dev port | 3003 | 3000 |
| Languages | 8 | 2 (English, Spanish) |
| Scala source | `Main.scala` only | `Main.scala` plus three extension registrations |
| Extension points used | 3 of 5 | 5 of 5 |
| Production build target | `make credit-assistant` | `make twe` |
| Read it for | The smaller introduction to the library | How far an application can customize the generated site |

## Repository layout

| Path | Contents |
|---|---|
| `credit-assistant/` | The EITC application. Its own sbt build, Makefile, docs, and resources |
| `tax-withholding-estimator/` | The withholding application, same shape |
| `CONTRIBUTING.md`, `LICENSE.md` | Cover both applications |

The two directories share no code and no build. Each has its own `build.sbt`, `package.json`,
`Makefile`, and `fact-explorer.app.json`, and each can be built without the other.

## The three repositories these depend on

| Repository | Provides | How it arrives |
|---|---|---|
| [form-builder](https://github.com/IRS-Public/form-builder) | The Scala library that turns Flow XML plus a Fact Dictionary into a static site. It also ships the browser theme and the flow runtime inside its jar | sbt dependency `gov.irs::form-builder` `0.1.0-SNAPSHOT`, resolved from the local Ivy cache. `sbt publishLocal` in a checkout puts it there |
| [fact-graph](https://github.com/IRS-Public/fact-graph) | The declarative evaluation engine, cross-compiled to the JVM and to JavaScript | Transitively on the JVM side. The browser bundle is committed under each app's `website-static/vendor/fact-graph/` and refreshed by `make copy-fg` |
| [taxpert](https://github.com/IRS-Public/taxpert) | The optional workspace UI (global nav, audit panel, tool panels), plus Fact Explorer and the assistant backend | A `file:` npm dependency on a checkout at `taxpert/packages/ui`, mirrored into `website-static/vendor/taxpert/` by `make copy-shared-ui` |

Only Form Builder is required. An application still runs with no taxpert installed, because the theme
and the questionnaire runtime come from Form Builder's jar. Taxpert adds the tooling that lets you
inspect a running application.

## Getting a build to run

None of the three libraries is on a public artifact registry, so all three come from checkouts.
Clone them into the root of this repository, beside the two application directories:

```bash
git clone https://github.com/IRS-Public/fact-graph
git clone https://github.com/IRS-Public/form-builder
git clone https://github.com/IRS-Public/taxpert
```

That layout is what the relative paths in each Makefile and `package.json` resolve against —
`../fact-graph`, `../form-builder` and `../taxpert/packages/ui`, all relative to the application
directory. The three clones are gitignored here; each is its own repository.

Then, in either application directory:

```bash
make bootstrap  # once: publish the two Scala libraries, install the npm dependencies, vendor the assets
make dev        # build and serve, watching for changes
```

`make bootstrap` runs `sbt compile fastOptJS publishLocal` in fact-graph and `sbt publishLocal` in
form-builder, which lands both in `~/.ivy2/local` — already first in sbt's resolver chain, so
neither `build.sbt` declares a resolver or credentials. It then runs `npm install`, which resolves
`taxpert` from its checkout, and vendors the Fact Graph browser bundle and the taxpert mirror into
`website-static/vendor/`.

A taxpert checkout kept somewhere other than the repository root can be installed from where it is,
without editing `package.json`:

```bash
make link-taxpert TAXPERT_UI=/path/to/taxpert/packages/ui
```

`make ci-setup` accepts the same variable, and installs only what the build and the validators need.

Fact Graph is optional if you are only working on templates, locales, or CSS: `make copy-fg` prints
a message and moves on when it finds no build at `../fact-graph/js/target/`, and each application's
committed browser bundle is used instead.

The other targets you will reach for:

```bash
make test       # ScalaTest plus scalafmt check
make ci         # the full build-and-validate pass
make help       # every documented target
```

The two Makefiles are close but not identical. `make site` is the app-agnostic alias for the
production build in both. Credit Assistant additionally has `make dev-ai`, `make dev-one-question`
and `make dev-author`. TWE additionally has `make validate-uswds`. See each application's README for
its full target list.

## Seeing inside a running application

Fact Explorer, in the taxpert repository, discovers applications by scanning a directory one level
deep for `fact-explorer.app.json` descriptors. One sits at the root of each application here, so
pointing the scan at this repository finds both:

```bash
cd /path/to/taxpert
FORM_BUILDER_APPS_DIR=/path/to/form-builder-examples \
  npm run build-registry --workspace packages/fact-explorer
```

The workspace UI in the applications themselves is switched on by a build flag. `make dev` already
passes `--auditMode` in both. In credit-assistant, `make dev-ai` also passes
`--aiScenarioGeneration --aiFactExplanation`, which reveal the two AI features in the audit panel.
TWE does not wire those features up.

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

The same three flags build `tax-withholding-estimator`. Nothing is authenticated and no secret is
mounted: the libraries are built from the checkouts you already have.

The mode flags are baked in at build time, because the generated site is static and there is no
server at runtime to pass them to. Credit Assistant's image is built with
`--auditMode --allScreens --scenarioMode`, TWE's with `--auditMode --allScreens`; changing either
means rebuilding the image.

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
