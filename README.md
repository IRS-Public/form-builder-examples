# Form Builder reference applications

Two working applications built on [Form Builder](https://github.com/IRS-Public/form-builder), kept
together so the scaffold has something real to be read against.

**This repository is demonstration code.** Nothing here is a library, and nothing here is meant to be
depended on. The reusable parts live in three other repositories; these two applications are what
they look like in use.

| | [`credit-assistant/`](credit-assistant/README.md) | [`tax-withholding-estimator/`](tax-withholding-estimator/README.md) |
|---|---|---|
| What it does | Screens a taxpayer for the Earned Income Tax Credit | Estimates federal income-tax withholding |
| Served at | `/app/eitc` | `/app/tax-withholding-estimator` |
| Dev port | 3003 | 3000 |
| Extension points used | 2 of 5 | all 5 |
| Read it for | The smaller introduction to the scaffold | How far an application can customize the generated site |

Both are static sites. The build emits HTML, CSS and a small amount of JavaScript — no database, no
session store, no application server.

## The three repositories these depend on

| Repository | Provides | How it arrives |
|---|---|---|
| [form-builder](https://github.com/IRS-Public/form-builder) | The Scala scaffold: Flow XML + a Fact Dictionary become a static site. Ships the browser theme and the flow runtime inside its jar. | sbt dependency `gov.irs::form-builder`, from GitHub Packages |
| [fact-graph](https://github.com/IRS-Public/fact-graph) | The declarative evaluation engine, cross-compiled to the JVM and to JavaScript | Transitively on the JVM side; the browser bundle is vendored by `make copy-fg` |
| [taxpert](https://github.com/IRS-Public/taxpert) | The **optional** workspace UI — global nav, audit panel, tool panels — plus Fact Explorer and the assistant backend | npm dependency `taxpert`, mirrored into `website-static/vendor/taxpert/` by `make copy-shared-ui` |

Only the first is required. An application still runs with no taxpert: the theme and the questionnaire
runtime come from Form Builder's jar. Taxpert is how you see *inside* a running application.

## Getting a build to run

Three prerequisites, in the order you will hit them.

**1. Fact Graph** is on neither Maven Central nor GitHub Packages, so it comes from a local publish:

```bash
git clone https://github.com/IRS-Public/fact-graph
cd fact-graph && sbt publishLocal        # -> ~/.ivy2/local, first in sbt's resolver chain
sbt fastOptJS                            # the browser bundle, for `make copy-fg`
```

Clone it beside these applications (`../fact-graph`) if you want `make copy-fg` to find it; the
target is skipped with a message when it cannot, and the committed bundle is used instead.

**2. Form Builder** resolves from GitHub Packages, which requires authentication *even to read a
public package*. Export a token with `read:packages` before building:

```bash
export GITHUB_ACTOR=<your-github-username>
export GITHUB_TOKEN=<a PAT with read:packages>
```

**3. Taxpert** is an ordinary npm dependency — but it is not published yet. Until it is, install it
from a checkout:

```bash
make link-taxpert TAXPERT_UI=/path/to/taxpert/packages/ui
```

That installs into `node_modules` without touching `package.json`, so `make copy-shared-ui` and
`make check-shared-ui` work unchanged and the committed dependency stays honest. `make ci-setup`
accepts the same variable, and leaves an already-installed copy alone:

```bash
make ci-setup TAXPERT_UI=/path/to/taxpert/packages/ui
```

Once taxpert is published to npm, drop the variable — a plain `npm install` resolves it.

Then, in either application directory:

```bash
make dev        # build and serve, watching for changes
make test       # ScalaTest + scalafmt check
make ci         # the full build-and-validate pass
make help       # every target
```

## Seeing inside a running application

Taxpert's Fact Explorer discovers applications by globbing a directory for `fact-explorer.app.json`
descriptors — one sits at the root of each application here. Point it at this repository:

```bash
cd /path/to/taxpert
FORM_BUILDER_APPS_DIR=/path/to/this/repo npm run build-registry
```

The workspace UI itself is a build flag rather than a separate service: `make dev` already passes
`--auditMode`. In credit-assistant, `make dev-ai` additionally reveals the two AI features; TWE
does not wire them up.
