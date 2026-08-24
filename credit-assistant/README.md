# Earned Income Tax Credit (EITC) Assistant

The EITC Assistant is an online tool provided by the Internal Revenue Service (IRS) to help taxpayers determine whether they are eligible for the [Earned Income Tax Credit (EITC)](https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit-eitc) and, if so, estimate the amount of the credit. By guiding users through the relevant questions and rules, it can reduce common errors, improve claim accuracy, and help taxpayers better understand the basis for their eligibility and credit calculation.

This directory holds the EITC-specific half of that tool: the flow XML, the fact dictionary, the locale files, the brand CSS, and a 37-line `Main.scala`. The XML parser, the site generators, the Thymeleaf engine, the browser theme and the flow runtime all come from **Form Builder**, a Scala library described under [Assembly](#assembly) below.

This codebase is actively maintained and reflects the version of the EITC Assistant that went live on April 29, 2026. Releases starting with v26.1.1 use the [Fact Graph](https://github.com/IRS-Public/fact-graph) to model the Internal Revenue Code, following similar projects like the [Tax Withholding Estimator](../tax-withholding-estimator/README.md) and [Direct File](https://github.com/IRS-Public/direct-file). Prior versions of the application, which used an imperative JavaScript approach, can be seen in the first few commits of the history this code was split out of.

For background on the tax rules themselves, see [Publication 596](https://www.irs.gov/publications/p596).

## Legal Disclaimer: Public Repository Access

> This repository contains draft and under-development source code for the IRS EITC Assistant. It is made available to the public solely for transparency, collaboration, and research purposes. The source code and associated content are not official IRS tools, and must not be used by taxpayers to determine their eligibility for EITC and estimate their credit.
>
> **No Endorsement or Warranty**
>
> IRS does not endorse, maintain, or guarantee the accuracy, completeness, or functionality of the code in this repository. The IRS assumes no responsibility or liability for any use of the code by external parties, including individuals, developers, or organizations. This includes, but is not limited to, any tax consequences, computation errors, data loss, or other outcomes resulting from the use or modification of this code.
>
> Use of the code in this repository is at your own risk. This repository is not intended for production use or public consumption as a finalized product.

## Assembly

The build takes two kinds of XML and produces a static site.

1. **A fact dictionary** (`facts/*.xml`) declares every fact: writable facts the taxpayer answers, derived facts computed from them, constants, and limits. At runtime these become a Fact Graph in the browser.
2. **A flow** (`flow/*.xml`) declares the screens: which fact each question binds to, which alerts appear under which conditions, and which questions live on which page.
3. **Locale YAML** supplies the words, in eight languages.
4. **Thymeleaf templates** turn parsed flow nodes into HTML, once per language.

Steps 1 through 3 are owned by this directory. Step 4 is almost entirely owned by the library.

### The three packages this app builds on

| Package | What it is | How it arrives |
|---|---|---|
| **Form Builder** (`gov.irs::form-builder` 0.1.0-SNAPSHOT) | The Scala library: flow parser, site generators, Thymeleaf engine, node templates, chrome locales, RELAX NG schemas, plus the browser theme and the flow runtime it serves. See [IRS-Public/form-builder](https://github.com/IRS-Public/form-builder). | An sbt dependency resolved from the local Ivy cache at `~/.ivy2/local`, where `sbt publishLocal` in a form-builder checkout puts it. That directory is already first in sbt's resolver chain, so `build.sbt` declares no resolver and no credentials. |
| **Fact Graph** (`gov.irs:factgraph` 3.1.0-SNAPSHOT) | The declarative evaluation engine, cross-compiled to the JVM and to JavaScript. See [IRS-Public/fact-graph](https://github.com/IRS-Public/fact-graph). | Transitively through Form Builder on the JVM side. The browser bundle is committed here and refreshed by `make copy-fg`. |
| **Taxpert** (`taxpert`, npm) | The optional workspace UI laid over a running app: global nav, audit panel, tool panels, all-screens toolbar. See [taxpert's `packages/ui`](https://github.com/IRS-Public/taxpert/blob/main/packages/ui/README.md). | A `file:` npm devDependency on a taxpert checkout at `../taxpert/packages/ui`, mirrored into `website-static/vendor/taxpert/` by `make copy-shared-ui`. `make link-taxpert TAXPERT_UI=…` installs it from a checkout kept elsewhere. |

An application built on Form Builder is called a **Form Builder app**. This repository holds the two that exist: this one and [`../tax-withholding-estimator/`](../tax-withholding-estimator/README.md). Credit Assistant is the simpler of the two and a reasonable place to start when reading the library.

Two components in the [taxpert repository](https://github.com/IRS-Public/taxpert) can point at this app. Neither is needed to build or run it.

- [`packages/fact-explorer/`](https://github.com/IRS-Public/taxpert/blob/main/packages/fact-explorer/README.md), a React and Vite SPA that visualizes any Form Builder app's flow and facts as a graph. It discovers this app through the `fact-explorer.app.json` descriptor at this directory's root.
- [`services/assistant/`](https://github.com/IRS-Public/taxpert/blob/main/services/assistant/README.md), a FastAPI backend that powers the audit panel's chat feature. The panel points at `http://localhost:8000`, and the app runs without it.

New apps are generated from the cookiecutter in [IRS-Public/form-builder-template](https://github.com/IRS-Public/form-builder-template).

## Requirements

| Tool | Version | Needed for |
|---|---|---|
| JDK | 21 (what the Docker images build with) | Running sbt |
| Scala | 3.7.2 (declared in [`build.sbt`](./build.sbt)) | The build |
| sbt | 1.x | The build |
| `xmllint` (from `libxml2`) | any | `make format`, `make validate-xml` |
| Node and npm | any current LTS | JS and HTML linting, and the `taxpert` mirror |

Scala and sbt can be installed with [Coursier](https://get-coursier.io/), [SDKMAN](https://sdkman.io/), [asdf](https://asdf-vm.com/), [mise](https://mise.jdx.dev/), or any other method you prefer.

## Quickstart

```bash
# 1. Clone the three libraries into this repository's root, beside the two applications.
#    None of them is on a public artifact registry, and every relative path below assumes
#    this layout.
git clone https://github.com/IRS-Public/fact-graph.git
git clone https://github.com/IRS-Public/form-builder.git
git clone https://github.com/IRS-Public/taxpert.git

# 2. Publish fact-graph and form-builder to your local Ivy repository, install the npm
#    dependencies, and vendor the Fact Graph bundle and the taxpert mirror
make bootstrap

# 3. Build and serve, rebuilding on change
make
```

`make` with no target runs `make dev`. That serves the site at **http://localhost:3003/app/eitc** with `--auditMode --allScreens --scenarioMode`, so two extra destinations exist alongside the flow:

| URL | Available under |
|---|---|
| `http://localhost:3003/app/eitc` | Always |
| `http://localhost:3003/app/eitc/all-screens/` | `--allScreens`, which `make dev` passes |
| `http://localhost:3003/app/eitc/author/` | `--authorMode` (`make dev-author`), with its editing API on port 3004 |

All three clones are needed for a build from scratch: `gov.irs::factgraph` is published to no registry, so form-builder cannot resolve without a local publish of it. What is optional is refreshing the *browser* bundle. `make copy-fg` prints a message and moves on when it finds no build at `../fact-graph/js/target/`, and the checked-in bundle under `website-static/vendor/fact-graph/` is used instead.

### Docker

[`Dockerfile`](./Dockerfile) builds in three stages: the first publishes fact-graph and form-builder into the image's own Ivy cache, the second generates the site with sbt, and the third serves `./out` with nginx, using [`nginx.conf`](./nginx.conf). The mode flags are baked in at build time, so changing them means rebuilding the image.

The build context is this directory. The three libraries are separate repositories rather than subdirectories of it, so each arrives as a named additional build context, and nothing is authenticated:

```bash
docker build \
  --build-context fact_graph=../fact-graph \
  --build-context form-builder=../form-builder \
  --build-context taxpert=../taxpert/packages/ui \
  -t credit-assistant .
```

More setup notes, including LSP integration, are in the [Dev Onboarding Docs](./docs/onboarding/onboarding-dev.md). IRS employees should start with the [IRS Onboarding Docs](./docs/onboarding/onboarding-irs.md), and non-developers with the [Non-Dev Onboarding Docs](./docs/onboarding/onboarding-nondev.md). One IDE guide lives under [`docs/onboarding/ide/intellij/live-templates/`](./docs/onboarding/ide/intellij/live-templates/README.md), covering the shared flow-XML Live Templates.

## Make targets

`make help` prints most of this list from the shell. `dev-one-question` is the one target it omits, because its help comment is not marked for the help scraper.

### Running

| Target | Effect |
|---|---|
| `make dev` | Default. Build and serve on port 3003, watching for changes. Flags: `--serve --auditMode --allScreens --scenarioMode` |
| `make dev-ai` | As `dev`, plus `--aiScenarioGeneration --aiFactExplanation`, which reveal the two AI features in the audit panel |
| `make dev-one-question` | As `dev`, plus `--singleQuestionPerScreen`, which splits every page into one question per screen |
| `make dev-author` | As `dev`, plus `--authorMode`, which serves the authoring UI and starts its editing API on port 3004 |
| `make debug` | As `dev`, with a JVM debug port on 5005 |

Override the HTTP port with `make dev PORT=4000`, and the debug port with `DEBUGGER_PORT`. `dev-author` hardcodes 3003 and 3004 and ignores `PORT`.

### Building

| Target | Effect |
|---|---|
| `make bootstrap` | One-time setup: publish fact-graph and form-builder to `~/.ivy2/local`, install the npm dependencies, and vendor the Fact Graph bundle and the taxpert mirror |
| `make credit-assistant` | Production build into `./out`, no server |
| `make site` | Alias for `credit-assistant`, under the name every Form Builder app uses |
| `make fact-explorer` | Build with `--formBuilderGraph` (emits `resources/form-builder-graph.json`) and print this app's Fact Explorer URL |
| `make copy-fg` | Copy the compiled Fact Graph JS bundle from a `../fact-graph` checkout |
| `make copy-shared-ui` | Regenerate the vendored `taxpert` mirror from `node_modules/taxpert/src` |
| `make link-taxpert` | Install the workspace UI from a taxpert checkout kept somewhere other than `../taxpert`. Requires `TAXPERT_UI=/path/to/taxpert/packages/ui` |
| `make clean` | Remove `./target/`, `./project/*/target/`, and `./out/` |
| `make diff-out` | Build `main` in a throwaway worktree and diff the two `out/` trees, via `scripts/diff-out.sh` |

### Testing and validation

| Target | Effect |
|---|---|
| `make test` | ScalaTest suite plus `scalafmtCheckAll` |
| `make test-watch` | The suite, re-run on change |
| `make format` | `xmllint --format` over `facts/*.xml`, then `scalafmtAll`, then `eslint --fix` over the JS |
| `make ci` | Production build, then every check below except `semgrep` |
| `make ci-setup` | `npm install` in `src/main/resources/credit-assistant/` and at this directory's root |
| `make check-shared-ui` | Fail if the vendored `taxpert` mirror has drifted from `node_modules/taxpert/src` |
| `make validate-xml` | `xmllint --relaxng` over `facts/*.xml` and `flow/*.xml` |
| `make validate-html` | `html-validate` over the generated HTML in `./out` |
| `make validate-templates` | Reject HTML comments inside inline `<script>` blocks |
| `make validate-js` | ESLint over `website-static/js/` |
| `make validate-scala` | `scalafmtCheckAll` |
| `make semgrep` | Semgrep security and Scala rulesets. Not part of `make ci`, and not installed by `ci-setup` |

## Layout

```
build.sbt                              one dependency: gov.irs::form-builder 0.1.0-SNAPSHOT
package.json                           devDependencies: eslint, @eslint/js, taxpert (file:../taxpert/packages/ui)
fact-explorer.app.json                 this app, as Fact Explorer discovers it
code.json                              federal source-code inventory metadata
Dockerfile, nginx.conf                 container build and static serving
scripts/diff-out.sh                    backing script for `make diff-out`
src/main/scala/gov/irs/creditassistant/Main.scala
src/main/resources/credit-assistant/   everything the generator reads from disk
src/test/                              ScalaTest suites and CSV scenario fixtures
```

Inside `src/main/resources/credit-assistant/`:

| Directory | Contents |
|---|---|
| `facts/` | The fact dictionary, split by domain, plus `FactDictionaryModule.rng` |
| `flow/` | The flow, split into five modules, plus `index.xml` and `FlowConfig.rng` |
| `locales/` | Eight `{lang}.yaml` files and eight `flow_{lang}.yaml` files |
| `templates/` | This app's Thymeleaf overrides. Five fragments, and no node or input template |
| `website-static/` | Everything copied verbatim to `{basePath}/resources/` |
| `scenarios/` | 114 saved Fact Graph states the audit panel can load, served only under `--scenarioMode` |
| `package.json`, `eslint.config.js`, `htmlvalidate.json` | The Node toolchain for linting. Node is not required to build the site, only to run the checks |

### Fact dictionary

Every file in `facts/` is loaded **alphabetically** and merged into one dictionary. On a duplicate path, the last definition wins.

| File | Domain |
|---|---|
| `adjustments.xml` | AGI adjustments (IRA, HSA, educator expenses) |
| `constants.xml` | Tax year selection, delegating to the year-specific files below |
| `constants2023.xml` to `constants2026.xml` | Year-specific EITC thresholds, rates, and limits |
| `educatorExpenseAdjustment.xml` | Educator expense logic |
| `eitcCalculations.xml` | Credit amount calculation |
| `eitcEligibility.xml` | Core eligibility tests (age, SSN, citizenship) |
| `familyAndHousehold.xml` | The qualifying-child collection under `/familyAndHousehold/*` |
| `filers.xml` | Primary and secondary filer identity |
| `filingStatus.xml` | Filing status derivations |
| `flowConfirmations.xml` | Flow gate facts (`flowShouldShow*`, `flowClickedNext*`) |
| `income.xml` | Income source writables |
| `predicates.xml` | Cross-cutting boolean predicates |
| `selfEmployment.xml` | Self-employment income, expenses, and tax |
| `socialSecurity.xml` | Social Security benefit calculations |
| `studentLoanInterestDeduction.xml` | Student loan interest deduction |

### Flow

`flow/index.xml` names five modules, spliced in at parse time and stamped with the module they came from so the Browse All listing can group by section.

| Module | Covers |
|---|---|
| `about-you.xml` | Identity, residency, and SSN questions |
| `filing-status.xml` | Filing status |
| `agi.xml` | Income and adjustments |
| `qualifying-children.xml` | The qualifying-child collection |
| `results.xml` | Determination and credit amount |

Each `<page route="...">` becomes one HTML page per language. The elements a page is built from (`<fg-set>`, `<fg-collection>`, `<fg-alert>`, `<fg-detail>`, `<modal-dialog>`) belong to the library, and their parsers and templates live in [form-builder](https://github.com/IRS-Public/form-builder).

## App configuration

`src/main/scala/gov/irs/creditassistant/Main.scala` builds one `FormBuilderApp` and hands it to `FormBuilder.run`. That is this app's entire Scala surface, 37 lines including the doc comment.

| Field | Value | Meaning |
|---|---|---|
| `appId` | `credit-assistant` | The resource directory under `src/main/resources`, and the classpath prefix template overrides resolve from |
| `basePath` | `/app/eitc` | The URL prefix every generated link and asset href is built from |
| `outSubdir` | `app/eitc` | Where the site is written beneath `./out` |
| `locales` | `en`, `es`, `ht`, `ko`, `ru`, `vi`, `zh-hans`, `zh-hant` | Insertion-ordered. The first entry is generated at the site root, the rest under `/{code}/` |
| `defaultPort` | `3002` | The dev server port when `-Dsmol.port` is unset |
| `brand` | `Credit Assistant` | The product name in the dev server banner |
| `storagePrefix` | not set, so it defaults to `appId` | Namespaces every browser storage key the site writes |
| `nodeTypes` | not set, so empty | This app registers no custom flow elements |
| `inputTypes` | not set, so empty | This app registers no custom input types |

The directory name, the resource directory name, and the URL segment are three independent names, and this app has different values for two of them. It lives in `credit-assistant/`, keeps its resources under `credit-assistant/`, and serves from `/app/eitc`.

## Extension points

Form Builder offers five seams. This app uses three of them, which is what makes it the smaller example. [`../tax-withholding-estimator/`](../tax-withholding-estimator/README.md) exercises all five.

| Seam | Used here? |
|---|---|
| Template overrides (`{appId}/templates/` resolves before `form-builder/templates/`) | Yes, but only the five fragments listed below. No node or input template is overridden |
| Locale layering (app YAML over library YAML over generated `flow_{lang}.yaml`) | Yes, `locales/{lang}.yaml` |
| `nodeTypes` (custom flow elements) | No |
| `inputTypes` (custom or replacement input types) | No |
| Workspace mount fragments | Yes, all four |

Of the five fragments this app overrides, four are the workspace mounts and the fifth is `fragments/audit-panel.html`, where the library's version is a working default that this app replaces to register its own panel extensions.

### Static assets the library expects

The library's templates reference a small number of app-owned paths under `{basePath}/resources/`. Supplying them is part of being a Form Builder app.

| Path | Referenced by | Present here |
|---|---|---|
| `styles/main.css` | `fragments/head.html`, always | Yes |
| `js/fg-components.js` | `fragments/head.html`, always | Yes |
| `styles/all-screens.css` | `all-screens.html`, under `--allScreens` | Yes |
| `js/all-screens-bootstrap.js` | `all-screens.html`, under `--allScreens` | Yes |
| `styles/components/author-mode.css` | `author-mode.html`, under `--authorMode` | Yes |
| `js/author-mode.js` | `author-mode.html`, under `--authorMode` | Yes |

`website-static/js/fg-components.js` is the flow entry point. It imports the library's runtime from `vendor/form-builder/flow-runtime/js/flow-runtime.js`, which is what defines `<fg-set>`, `<fg-collection>` and `<fg-show>`, and then imports this app's two additions: `fg-knockout-handlers.js` (reveal-on-continue behaviour for the knockout gates) and `fg-flow-confirmations.js`.

### Workspace mount fragments

Form Builder decides that there is a workspace slot and when it is filled (`--auditMode`). It ships an empty or minimal default for each fragment below and names no path inside `vendor/taxpert/` anywhere. Filling them is this app's job, which is what lets an app drop the workspace dependency entirely.

| `templates/fragments/` | Fills |
|---|---|
| `workspace-head.html` | The stylesheet link, the template preload, and the element modules in `<head>` |
| `workspace-enable.html` | The `enable()` call at the end of `<body>` |
| `workspace-all-screens.html` | The screens toolbar on the Browse All page |
| `taxpert-config.html` | The `configure()` call: nav taxonomy, app switcher, endpoints, feature flags, tools, and the determinations the Outcome tracker follows |
| `audit-panel.html` | The `<taxpert-audit-panel>` element itself, with this app's chat and scenario endpoints and its two panel extensions |

`taxpert-config.html` is a Thymeleaf fragment, so every user-visible string in it can be a translated message key. The parts that cannot be a literal (the fact-graph adapter and the fact paths) live in `website-static/js/taxpert/eitc-graph.js` and are imported from it.

`website-static/taxpert.config.json` is fetched at runtime and merged over that call, so a deployment can change workspace settings without a rebuild. The shipped file is `{}`.

## Generated vendor directories

**Nothing under `website-static/vendor/` should be hand-edited, and `vendor/taxpert/` should never be committed.**

| Directory | Source | How it is refreshed | Tracked in git? |
|---|---|---|---|
| `vendor/taxpert/` | `node_modules/taxpert/src/` | `make copy-shared-ui`, which every build and dev target depends on | No, gitignored. A fresh clone has none until a build runs |
| `vendor/form-builder/` | The `form-builder` jar | Extracted by the generator on every build | No, it only exists in `./out` |
| `vendor/fact-graph/` | A [fact-graph](https://github.com/IRS-Public/fact-graph) checkout at `../fact-graph` | `make copy-fg` | Yes, apart from the `.map` file |
| `vendor/uswds-3.13.0/` | USWDS release | Manually, on a USWDS upgrade | Yes |

To change any shared workspace UI, edit `packages/ui/src/` in the [taxpert](https://github.com/IRS-Public/taxpert) repository, run `npm test` there, reinstall it here, then `make copy-shared-ui`. `make check-shared-ui` (run by `make ci`) fails if the mirror and the installed package disagree, which catches a hand-edit before it reaches a browser.

To change the theme or the flow runtime, edit `src/main/resources/form-builder/website-static/` in the [form-builder](https://github.com/IRS-Public/form-builder) repository, publish it, and restart. There is no `make` target for these, and no live reload.

## Internationalization

Eight languages, two tiers per language.

| File | Maintained by | Notes |
|---|---|---|
| `locales/{lang}.yaml` | Humans | This app's own static UI strings |
| `locales/flow_en.yaml` | The build | Extracted from the flow XML on every run. Do not edit |
| `locales/flow_{lang}.yaml` | Humans | Translations of the keys in `flow_en.yaml` |

Lookup order is `{lang}.yaml`, then `flow_{lang}.yaml`. Form Builder ships its own eight-language chrome YAML underneath both (`components.*`, `buttons.*`, `alerts.*`, `errors.*`, `step-indicator.*`, `layout.*`, `audit.*`, `all-screens.*`), and this app's file layers over it. `locales/en.yaml` here therefore holds only what this app adds or replaces, chiefly its `title`, its `all-screens.section.*` keys (one per flow module), and the whole `workspace.*` tree the nav and tool panels are labelled from. Because of that layering, `YamlValidatorSpec` compares the merged result rather than this app's file on its own.

## Testing

```bash
make test
sbt "testOnly gov.irs.creditassistant.factdictionary.AdjustmentsAgiKnockoutGateSpec"
```

| Package | Covers |
|---|---|
| `factdictionary.*` | Fact logic. Extends `CreditAssistantTestHelpers` |
| `parser.*` | Flow XML parsing |
| `authoring.*` | Author Mode's XML round-tripping |
| `YamlValidatorSpec` | Locale key consistency across the layered result |

`CreditAssistantTestHelpers` provides `newFactGraph()`, `booleanAt(graph, path)`, `assertBooleanGateOff(graph, path)`, `applyEitcCsvScenarioBaseline(graph, claimingQc)`, and `addEitcQualifyingChildUnder19(graph)`.

Five CSV fixtures in `src/test/resources/csv/` drive table-based scenario suites covering broad eligibility, the qualifying-child age test, residency and joint-return rules, and the no-qualifying-child path.

## Gotchas

- **A change to Form Builder has to be republished before this app sees it.** In a form-builder checkout, `sbt test publishLocal`, then point `build.sbt` at that version. This applies to parser changes, generator changes, node templates, chrome locales, the theme, and the flow runtime. After such a change, run `make ci` in both applications, because the second one is what catches an app-specific assumption.
- **`defaultPort` and the dev port differ.** `Main.scala` declares 3002, but the Makefile always passes `-Dsmol.port=3003`, so `make dev` serves on 3003. `fact-explorer.app.json` records 3003 to match the Makefile.
- **Flow, facts, and this app's locales are read from disk rather than the classpath.** Author Mode patches XML on disk and re-runs the generator in process, and a classpath read would serve sbt's stale `target/` copy. The library's own templates and base locales do come off the classpath.
- **`make ci-setup` runs `npm install` twice**, once in `src/main/resources/credit-assistant/` for the lint tooling and once at this directory's root for the `taxpert` dependency. A clean checkout that skips it fails inside `copy-shared-ui`.
- **`make fact-explorer` is separate from `make dev` on purpose.** The Scala graph generator does not yet emit the `shows` and `exits` edges Fact Explorer's own generator produces, and Fact Explorer prefers an app-served graph wherever it finds one. The target's closing message still prints a `cd ../fact-explorer` path from the old monorepo layout. Fact Explorer now lives at `packages/fact-explorer` in the taxpert repository.
- **HTML comments inside an inline `<script type="module">` are a syntax error**, and they fail silently at runtime. `make validate-templates` exists to catch that.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details, along with [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), [GOVERNANCE.md](./GOVERNANCE.md), [COMMUNITY.md](./COMMUNITY.md), and [SECURITY.md](./SECURITY.md).

This codebase is dedicated to the public domain under the [Creative Commons Zero v1.0 Universal](LICENSE.md) license (CC0 1.0).

## Authorities

Legal foundations for this work include:

* Source Code Harmonization And Reuse in Information Technology Act of 2024, Public Law 118-187
* OMB Memorandum M-16-21, "Federal Source Code Policy: Achieving Efficiency, Transparency, and Innovation through Reusable and Open Source Software," August 8, 2016
* Federal Acquisition Regulation (FAR) Part 27, Patents, Data, and Copyrights
* Digital Government Strategy: "Digital Government: Building a 21st Century Platform to Better Serve the American People," May 23, 2012
* Federal Information Technology Acquisition Reform Act (FITARA), December 2014 (National Defense Authorization Act for Fiscal Year 2015, Title VIII, Subtitle D)
* E-Government Act of 2002, Public Law 107-347
* Clinger-Cohen Act of 1996, Public Law 104-106
