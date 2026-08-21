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
| [form-builder](https://github.com/IRS-Public/form-builder) | The Scala library that turns Flow XML plus a Fact Dictionary into a static site. It also ships the browser theme and the flow runtime inside its jar | sbt dependency `gov.irs::form-builder` `0.1.0`, resolved from GitHub Packages |
| [fact-graph](https://github.com/IRS-Public/fact-graph) | The declarative evaluation engine, cross-compiled to the JVM and to JavaScript | Transitively on the JVM side. The browser bundle is committed under each app's `website-static/vendor/fact-graph/` and refreshed by `make copy-fg` |
| [taxpert](https://github.com/IRS-Public/taxpert) | The optional workspace UI (global nav, audit panel, tool panels), plus Fact Explorer and the assistant backend | npm dependency `taxpert`, mirrored into `website-static/vendor/taxpert/` by `make copy-shared-ui` |

Only Form Builder is required. An application still runs with no taxpert installed, because the theme
and the questionnaire runtime come from Form Builder's jar. Taxpert adds the tooling that lets you
inspect a running application.

## Getting a build to run

Three prerequisites, in the order you will hit them.

**1. Fact Graph** is on no public artifact registry, so it comes from a local publish:

```bash
git clone https://github.com/IRS-Public/fact-graph
cd fact-graph
sbt publishLocal    # lands 3.1.0-SNAPSHOT in ~/.ivy2/local, first in sbt's resolver chain
sbt fastOptJS       # the browser bundle, for `make copy-fg`
```

Each app's `make copy-fg` looks for the compiled bundle at `../fact-graph/js/target/`, relative to the
app directory. Cloning fact-graph into the root of this repository, beside `credit-assistant/` and
`tax-withholding-estimator/`, is what makes that path resolve. The target prints a message and moves
on when it finds nothing there, and the committed bundle is used instead.

**2. Form Builder** resolves from GitHub Packages, which requires authentication even to read a public
package. Export a token with `read:packages` before building:

```bash
export GITHUB_OWNER=IRS-Public
export GITHUB_ACTOR=<your-github-username>
export GITHUB_TOKEN=<a PAT with read:packages>
```

**3. Taxpert** is an ordinary npm dependency that has not been published yet. Until it is, install it
from a checkout of the taxpert repository:

```bash
make link-taxpert TAXPERT_UI=/path/to/taxpert/packages/ui
```

That installs into `node_modules` without touching `package.json`, so `make copy-shared-ui` and
`make check-shared-ui` work unchanged and the committed dependency stays accurate. `make ci-setup`
accepts the same variable and leaves an already-installed copy alone:

```bash
make ci-setup TAXPERT_UI=/path/to/taxpert/packages/ui
```

Once taxpert is published to npm, drop the variable and a plain `npm install` resolves it.

Then, in either application directory:

```bash
make dev        # build and serve, watching for changes
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
`./out` with nginx. Both Dockerfiles still assume the older monorepo layout: their `COPY` paths name
`examples/<app>/` and `packages/ui/src`, and their header comments reference a `docker-compose.yml`
that this repository does not contain. Treat them as a reference for the two-stage build shape rather
than as something that builds as written.

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
