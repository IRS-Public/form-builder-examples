# Tax Withholding Estimator (TWE)

TWE is an online tool provided by the Internal Revenue Service (IRS) designed to help taxpayers estimate their federal tax withholding while preparing [Form W-4](https://www.irs.gov/pub/irs-pdf/fw4.pdf) or [Form W-4P](https://www.irs.gov/pub/irs-pdf/fw4p.pdf). It handles multiple jobs, self-employment income, and a wide range of credits and deductions. For the math behind withholding, see [docs/taxes/withholdings-basics.md](./docs/taxes/withholdings-basics.md).

This directory holds the withholding-specific half of that tool: the flow XML, the fact dictionary, the locale files, the brand CSS, the W-4 PDF filler, and five Scala files. The XML parser, the site generators, the Thymeleaf engine, the browser theme and the flow runtime all come from **Form Builder**, a Scala library described under [Assembly](#assembly) below.

This codebase is actively maintained and represents the version of TWE (TWE 2.0) that went live on February 27, 2026. For the architecture and technical design decisions behind the move from TWE 1.0, start with [docs/adr/001-twe-architecture.md](./docs/adr/001-twe-architecture.md).

## Scope

TWE helps taxpayers avoid surprises at filing time by reducing the likelihood of overwithholding (a large refund) or underwithholding (a balance due). Its primary output is a prefilled Form W-4 for employees or Form W-4P for pension recipients, based on the taxpayer's current situation. Without specific values in lines 3 through 4c of those forms, payors fall back on the default assumptions in [Pub. 15](https://www.irs.gov/pub/irs-pdf/p15.pdf) and [Pub. 15-T](https://www.irs.gov/pub/irs-pdf/p15t.pdf), which can withhold inaccurately for more complex tax profiles.

Three things separate TWE from filing software:

- **No filing.** TWE sends no data to the IRS. It estimates tax liability and uses that estimate to prefill Forms W-4 and W-4P, which the taxpayer then provides to their employer or pension provider.
- **Forward-looking estimates.** A tax return works backward from finalized W-2s and 1099s. TWE runs during the tax year, using year-to-date data plus estimates for the remaining months, so its output is an approximation.
- **Federal only.** State and local income taxes and withholding are out of scope.

Open-sourcing the project is intended to show how TWE generates withholding recommendations and estimates tax liability, so that taxpayers can see how the core tax engine processes data and applies year-to-date assumptions.

## Legal Disclaimer: Public Repository Access

> This repository contains draft and under-development source code for the IRS Tax Withholding Estimator. It is made available to the public solely for transparency, collaboration, and research purposes. The source code and associated content are not official IRS tools, and must not be used by taxpayers to estimate federal income tax withholding from their paychecks.
>
> **No Endorsement or Warranty**
>
> IRS does not endorse, maintain, or guarantee the accuracy, completeness, or functionality of the code in this repository. The IRS assumes no responsibility or liability for any use of the code by external parties, including individuals, developers, or organizations. This includes, but is not limited to, any tax consequences, computation errors, data loss, or other outcomes resulting from the use or modification of this code.
>
> **Official Tool for Tax Withholding Estimation**
>
> If you are a taxpayer seeking to estimate the federal income tax you want your employer to withhold from your paycheck, please use the official IRS Tax Withholding Estimator available at https://www.irs.gov/individuals/tax-withholding-estimator. If you are a taxpayer seeking to understand tax withholding and the Internal Revenue Code (IRC), please review official IRS [Publications](https://www.irs.gov/publications), [Forms](https://www.irs.gov/forms-instructions) or [guidance](https://www.irs.gov/newsroom/irs-guidance). Names and identifiers used in source code or other artifacts (for example, the names of Facts) in this repository are not intended to reflect official interpretation of the IRC or replacement of IRS Publications, Forms, or Guidance.
>
> Use of the code in this repository is at your own risk. This repository is not intended for production use or public consumption as a finalized product.

## Assembly

The build takes two kinds of XML and produces a static site.

1. **A fact dictionary** (`facts/*.xml`) declares every fact: writable facts the taxpayer answers, derived facts computed from them, constants, and limits. At runtime these become a Fact Graph in the browser.
2. **A flow** (`flow/*.xml`) declares the screens: which fact each question binds to, which alerts appear under which conditions, and which questions live on which page.
3. **Locale YAML** supplies the words, in English and Spanish.
4. **Thymeleaf templates** turn parsed flow nodes into HTML, once per language.

Steps 1 through 3 are owned by this directory. Step 4 is mostly owned by the library, with the eleven template files listed under [Extension points](#extension-points).

### The three packages this app builds on

| Package | What it is | How it arrives |
|---|---|---|
| **Form Builder** (`gov.irs::form-builder` 0.1.0-SNAPSHOT) | The Scala library: flow parser, site generators, Thymeleaf engine, node templates, chrome locales, RELAX NG schemas, plus the browser theme and the flow runtime it serves. See [IRS-Public/form-builder](https://github.com/IRS-Public/form-builder). | An sbt dependency resolved from the local Ivy cache at `~/.ivy2/local`, where `sbt publishLocal` in a form-builder checkout puts it. That directory is already first in sbt's resolver chain, so `build.sbt` declares no resolver and no credentials. |
| **Fact Graph** (`gov.irs:factgraph` 3.1.0-SNAPSHOT) | The declarative evaluation engine, cross-compiled to the JVM and to JavaScript. See [IRS-Public/fact-graph](https://github.com/IRS-Public/fact-graph). | Transitively through Form Builder on the JVM side. The browser bundle is committed here and refreshed by `make copy-fg`. |
| **Taxpert** (`taxpert`, npm) | The optional workspace UI laid over a running app: global nav, audit panel, tool panels, all-screens toolbar. See [taxpert's `packages/ui`](https://github.com/IRS-Public/taxpert/blob/main/packages/ui/README.md). | A `file:` npm devDependency on a taxpert checkout at `../taxpert/packages/ui`, mirrored into `website-static/vendor/taxpert/` by `make copy-shared-ui`. `make link-taxpert TAXPERT_UI=…` installs it from a checkout kept elsewhere. |

One more direct sbt dependency is specific to this app: `com.github.tototoshi::scala-csv`, which the UAT scenario suite uses to read its spreadsheet.

An application built on Form Builder is called a **Form Builder app**. This repository holds the two that exist: this one and [`../credit-assistant/`](../credit-assistant/README.md). Credit Assistant is the smaller of the two and the easier introduction to the library. TWE uses every extension point Form Builder offers, so read it when you want to see how far an app can customize the generated site.

Two components in the [taxpert repository](https://github.com/IRS-Public/taxpert) can point at this app. Neither is needed to build or run it.

- [`packages/fact-explorer/`](https://github.com/IRS-Public/taxpert/blob/main/packages/fact-explorer/README.md), a React and Vite SPA that visualizes any Form Builder app's flow and facts as a graph. It discovers this app through the `fact-explorer.app.json` descriptor at this directory's root, which also declares the custom flow tag below.
- [`services/assistant/`](https://github.com/IRS-Public/taxpert/blob/main/services/assistant/README.md), a FastAPI backend for the audit panel's chat feature. This app does not wire it up, and its `fragments/audit-panel.html` override drops the chat endpoint entirely.

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

`make` with no target runs `make dev`. The site is served at **http://localhost:3000/app/tax-withholding-estimator**, and the Browse All listing at **http://localhost:3000/app/tax-withholding-estimator/all-screens/**.

All three clones are needed for a build from scratch: `gov.irs::factgraph` is published to no registry, so form-builder cannot resolve without a local publish of it. What is optional is refreshing the *browser* bundle. `make copy-fg` prints a message and moves on when it finds no build at `../fact-graph/js/target/`, and the checked-in bundle under `website-static/vendor/fact-graph/` is used instead.

### Docker

[`Dockerfile`](./Dockerfile) builds in three stages: the first publishes fact-graph and form-builder into the image's own Ivy cache, the second generates the site with sbt, and the third serves `./out` with nginx, using [`nginx.conf`](./nginx.conf). The mode flags are baked in at build time, so changing them means rebuilding the image.

The build context is this directory. The three libraries are separate repositories rather than subdirectories of it, so each arrives as a named additional build context, and nothing is authenticated:

```bash
docker build \
  --build-context fact_graph=../fact-graph \
  --build-context form-builder=../form-builder \
  --build-context taxpert=../taxpert/packages/ui \
  -t tax-withholding-estimator .
```

More setup notes, including LSP integration, are in the [Dev Onboarding Docs](./docs/onboarding/onboarding-dev.md). IRS employees should start with the [IRS Onboarding Docs](./docs/onboarding/onboarding-irs.md), and non-developers with the [Non-Dev Onboarding Docs](./docs/onboarding/onboarding-nondev.md). Two IDE guides live under `docs/onboarding/ide/intellij/`: the shared [Live Templates](./docs/onboarding/ide/intellij/live-templates/README.md), and [debugging a UAT scenario](./docs/onboarding/ide/intellij/scenario-debugging/README.md) with IntelliJ Watches.

## Make targets

Run `make help` for the same list from the shell.

### Running

| Target | Effect |
|---|---|
| `make dev` | Default. Build and serve on port 3000, watching for changes. Flags: `--serve --auditMode --allScreens` |
| `make debug` | As `dev`, with a JVM debug port on 5005 |

Override the HTTP port with `make dev PORT=4000`, and the debug port with `DEBUGGER_PORT`. This app declares neither scenarios nor Author Mode, so it has none of credit-assistant's `dev-ai`, `dev-one-question` or `dev-author` targets.

### Building

| Target | Effect |
|---|---|
| `make bootstrap` | One-time setup: publish fact-graph and form-builder to `~/.ivy2/local`, install the npm dependencies, and vendor the Fact Graph bundle and the taxpert mirror |
| `make twe` | Production build into `./out`, no server |
| `make site` | Alias for `twe`, under the name every Form Builder app uses |
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
| `make ci-setup` | `npm install` in `src/main/resources/twe/` and at this directory's root |
| `make check-shared-ui` | Fail if the vendored `taxpert` mirror has drifted from `node_modules/taxpert/src` |
| `make validate-xml` | `xmllint --relaxng` over `facts/*.xml` and `flow/*.xml` |
| `make validate-html` | `html-validate` over the generated HTML in `./out` |
| `make validate-templates` | Reject HTML comments inside inline `<script>` blocks |
| `make validate-js` | ESLint over `website-static/js/` |
| `make validate-uswds` | `scripts/check-uswds-semibold.sh`, which checks the vendored USWDS build still carries semibold |
| `make validate-scala` | `scalafmtCheckAll` |
| `make semgrep` | Semgrep security and Scala rulesets. Not part of `make ci`, and not installed by `ci-setup` |

## Layout

```
build.sbt                              gov.irs::form-builder, plus scala-csv for the UAT suite
package.json                           one devDependency: taxpert (file:../taxpert/packages/ui)
fact-explorer.app.json                 this app, as Fact Explorer discovers it
code.json                              federal source-code inventory metadata
Dockerfile, nginx.conf                 container build and static serving
scripts/                               diff-out.sh, check-uswds-semibold.sh, fgs.sh, reorder-yaml.sh
src/main/scala/gov/irs/twe/            Main.scala, the three extension registrations, Scenario.scala
src/main/resources/twe/                everything the generator reads from disk
src/test/                              ScalaTest suites and the UAT CSV fixture
```

Inside `src/main/resources/twe/` (see also its own [README](./src/main/resources/twe/README.md)):

| Directory | Contents |
|---|---|
| `facts/` | 43 fact files plus `FactDictionaryModule.rng` |
| `flow/` | Seven flow modules plus `index.xml` and `FlowConfig.rng` |
| `locales/` | `en.yaml`, `es.yaml`, `flow_en.yaml`, `flow_es.yaml` |
| `templates/` | This app's Thymeleaf overrides and additions, listed below |
| `website-static/` | Everything copied verbatim to `{basePath}/resources/`, including the three blank W-4 PDFs |
| `package.json`, `eslint.config.js`, `htmlvalidate.json` | The Node toolchain for linting, plus the `pdf-lib` version the vendored bundle tracks. Node is not required to build the site, only to run the checks |

Every file in `facts/` is loaded **alphabetically** and merged into one dictionary. On a duplicate path, the last definition wins.

`flow/index.xml` names seven modules, spliced in at parse time and stamped with the module they came from so the Browse All listing can group by section.

| Module | Covers |
|---|---|
| `about-you.xml` | Filing status and household |
| `income.xml` | Jobs, pensions, self-employment, Social Security |
| `adjustments.xml` | Income adjustments |
| `deductions.xml` | The standard and itemized deduction choice |
| `additional-deductions.xml` | The additional deductions layered on top |
| `credits.xml` | Credits |
| `results.xml` | The withholding recommendation and the prefilled forms |

## App configuration

`src/main/scala/gov/irs/twe/Main.scala` builds one `FormBuilderApp` and hands it to `FormBuilder.run`.

| Field | Value | Meaning |
|---|---|---|
| `appId` | `twe` | The resource directory under `src/main/resources`, and the classpath prefix template overrides resolve from |
| `basePath` | `/app/tax-withholding-estimator` | The URL prefix every generated link and asset href is built from |
| `outSubdir` | `app/tax-withholding-estimator` | Where the site is written beneath `./out` |
| `locales` | `en`, `es` | Insertion-ordered. English is generated at the site root, Spanish under `/es/` |
| `defaultPort` | `3000` | The dev server port when `-Dsmol.port` is unset. The Makefile passes the same value |
| `brand` | `Tax Withholding Estimator` | The product name in the dev server banner |
| `storagePrefix` | not set, so it defaults to `appId` | Namespaces every browser storage key the site writes |
| `nodeTypes` | `fg-withholding-adjustments` | See below |
| `inputTypes` | `single-checkbox`, `date` | See below |

The directory name, the resource directory name, and the URL segment are three independent names. Here they are `tax-withholding-estimator/`, `twe/`, and `/app/tax-withholding-estimator`.

## Extension points

Form Builder offers five seams, and this app uses all five. A seam exercised by only one application tends to drift back into that application's assumptions, so keeping a second one in the repository is what keeps them general.

### 1. A custom flow node type

`<fg-withholding-adjustments>` renders the W-4 or W-4P adjustment table, an element the library has never heard of.

| File | Role |
|---|---|
| `src/main/scala/gov/irs/twe/parser/FgWithholdingAdjustments.scala` | The `FlowNodeParser`. Reads `path`, an optional condition, and `form-type` (`w-4` or `w-4p`), then picks a template |
| `src/main/resources/twe/templates/nodes/fg-withholding-adjustments-w-4.html` | The W-4 rendering |
| `src/main/resources/twe/templates/nodes/fg-withholding-adjustments-w-4p.html` | The W-4P rendering |
| `src/main/resources/twe/website-static/js/fg-withholding-adjustments.js` | The browser-side custom element, imported by `js/fg-components.js` |
| `src/main/resources/twe/website-static/styles/components/fg-withholding-adjustment.css` | Its stylesheet, imported by `styles/main.css` |

Registered as `nodeTypes = Map("fg-withholding-adjustments" -> FgWithholdingAdjustments)`. A flow element the library does not recognise and no app has registered is treated as ordinary HTML. The tag is also listed in `fact-explorer.app.json` under `customFlowTags`, without which Fact Explorer's generator drops it from the graph.

### 2. A new input type

`<input type="single-checkbox"/>` renders one boolean as a lone checkbox that carries the question as its own label.

| File | Role |
|---|---|
| `src/main/scala/gov/irs/twe/inputs/SingleCheckbox.scala` | The `InputParser`. Binds to a `BooleanNode` and sets `suppliesOwnLabel = true` |
| `src/main/resources/twe/templates/nodes/inputs/single-checkbox.html` | Its template |

Because it supplies its own label, `fg-set` must not render one in front of it.

### 3. A replacement input type

`<input type="date" previous-years="1"/>` replaces the library's date input, swapping the free-text year field for a select over a window around the tax year.

| File | Role |
|---|---|
| `src/main/scala/gov/irs/twe/inputs/YearRangeDate.scala` | The `InputParser`. Reads `previous-years` and `future-years`, and pulls the tax year out of the fact dictionary so nobody has to repeat it in flow XML |
| `src/main/resources/twe/templates/nodes/inputs/date.html` | The overriding template |

This is registered under the existing name `date`. `FormBuilderApp.inputTypes` is merged over the built-ins, so registering an existing name reshapes that input rather than adding a second one.

### 4. Template overrides

Form Builder's template engine consults two `ClassLoaderTemplateResolver`s, `{appId}/templates/` first and `form-builder/templates/` second. A same-named file in this app's resources therefore wins, and every other library template is inherited untouched. Eleven files live here.

| `src/main/resources/twe/templates/` | Overrides or adds |
|---|---|
| `nodes/inputs/date.html` | **Overrides** the library's date input, for the year select above |
| `nodes/inputs/single-checkbox.html` | Adds the template for the new input type |
| `nodes/fg-withholding-adjustments-w-4.html`, `-w-4p.html` | Add the templates for the new node type |
| `fragments/app-head.html` | Overrides the library's empty default, to load `pdf-lib` and `js/w4-pdf.js` |
| `fragments/js-templates.html` | Overrides the library's default with this app's validation alert markup |
| `fragments/audit-panel.html` | Overrides the mount, dropping the chat and scenario endpoints this app has no backend for |
| `fragments/workspace-head.html`, `workspace-enable.html`, `workspace-all-screens.html`, `taxpert-config.html` | Fill the four workspace mounts, below |

Neither app overrides `page.html` or `all-screens.html`. If you find yourself about to, the change most likely belongs either in [form-builder](https://github.com/IRS-Public/form-builder) (the markup) or in taxpert's `packages/ui` (the styling and toolbars).

### 5. The workspace mounts

Form Builder decides that there is a workspace slot and when it is filled (`--auditMode`). It ships an empty default for each mount fragment and names no path inside `vendor/taxpert/` anywhere. Filling them is this app's job, which is what lets an app drop the workspace dependency entirely.

| `templates/fragments/` | Fills |
|---|---|
| `workspace-head.html` | The stylesheet link, the template preload, and the element modules in `<head>` |
| `workspace-enable.html` | The `enable()` call at the end of `<body>` |
| `workspace-all-screens.html` | The screens toolbar on the Browse All page |
| `taxpert-config.html` | The `configure()` call: nav taxonomy, app switcher, endpoints, tools, and the determinations the Outcome tracker follows |

`taxpert-config.html` is a Thymeleaf fragment, so every user-visible string in it can be a translated message key. The parts that cannot be a literal (the fact-graph adapter and the fact paths) live in `website-static/js/taxpert/twe-graph.js` and are imported from it. It also declares the **Overrides** tool over `/overrideDate`, which replaced this app's hand-built override control when the audit panel's legacy rail was retired.

`website-static/taxpert.config.json` is fetched at runtime and merged over that call, so a deployment can change workspace settings without a rebuild. The shipped file is `{}`.

### Static assets the library expects

The library's templates reference a small number of app-owned paths under `{basePath}/resources/`. Supplying them is part of being a Form Builder app.

| Path | Referenced by | Present here |
|---|---|---|
| `styles/main.css` | `fragments/head.html`, always | Yes |
| `js/fg-components.js` | `fragments/head.html`, always | Yes |
| `styles/all-screens.css` | `all-screens.html`, under `--allScreens` | Yes |
| `js/all-screens-bootstrap.js` | `all-screens.html`, under `--allScreens` | Yes |
| `styles/components/author-mode.css`, `js/author-mode.js` | `author-mode.html`, under `--authorMode` | No, and this app never runs with `--authorMode` |

`website-static/js/fg-components.js` is the flow entry point. It imports the library's runtime from `vendor/form-builder/flow-runtime/js/flow-runtime.js`, which defines `<fg-set>`, `<fg-collection>` and `<fg-show>`, and then imports this app's own `fg-withholding-adjustments.js`.

### PDF generation

`website-static/js/w4-pdf.js` fills the blank forms in `website-static/w4-templates/` (`fw4.pdf`, `fw4-es.pdf`, `fw4p.pdf`) in the browser, using the vendored `pdf-lib`. Neither Form Builder nor Taxpert produces a filled form, so both the library and the script are loaded through this app's `fragments/app-head.html`. The reasoning is in [docs/adr/003-pdf-generation.md](./docs/adr/003-pdf-generation.md).

## Generated vendor directories

**Nothing under `website-static/vendor/` should be hand-edited, and `vendor/taxpert/` should never be committed.**

| Directory | Source | How it is refreshed | Tracked in git? |
|---|---|---|---|
| `vendor/taxpert/` | `node_modules/taxpert/src/` | `make copy-shared-ui`, which every build and dev target depends on | No, gitignored. A fresh clone has none until a build runs |
| `vendor/form-builder/` | The `form-builder` jar | Extracted by the generator on every build | No, it only exists in `./out` |
| `vendor/fact-graph/` | A [fact-graph](https://github.com/IRS-Public/fact-graph) checkout at `../fact-graph` | `make copy-fg` | Yes, apart from the `.map` file |
| `vendor/uswds-3.13.0/` | USWDS release | Manually, on a USWDS upgrade. `make validate-uswds` guards the semibold weights | Yes |
| `vendor/pdf-lib-1.17.1.min.js` | pdf-lib release | Manually | Yes |

To change any shared workspace UI, edit `packages/ui/src/` in the [taxpert](https://github.com/IRS-Public/taxpert) repository, run `npm test` there, reinstall it here, then `make copy-shared-ui`. `make check-shared-ui` (run by `make ci`) fails if the mirror and the installed package disagree, which catches a hand-edit before it reaches a browser.

To change the theme or the flow runtime, edit `src/main/resources/form-builder/website-static/` in the [form-builder](https://github.com/IRS-Public/form-builder) repository, publish it, and restart. There is no `make` target for these, and no live reload.

## Internationalization

English and Spanish, two tiers per language.

| File | Maintained by | Notes |
|---|---|---|
| `locales/{lang}.yaml` | Humans | This app's own static UI strings |
| `locales/flow_en.yaml` | The build | Extracted from the flow XML on every run. Do not edit. `build.sbt` excludes it from `unmanagedResources` so regenerating it does not retrigger compilation |
| `locales/flow_es.yaml` | Humans | Translations of the keys in `flow_en.yaml` |

Lookup order is `{lang}.yaml`, then `flow_{lang}.yaml`. Form Builder ships its own chrome YAML underneath both (`components.*`, `buttons.*`, `alerts.*`, `errors.*`, `step-indicator.*`, `layout.*`, `audit.*`, `all-screens.*`), and this app's file layers over it. `locales/en.yaml` here therefore holds only what this app adds or replaces, chiefly its `title`, its `all-screens.section.*` keys (one per flow module), and the whole `workspace.*` tree the nav and tool panels are labelled from. Because of that layering, `YamlValidatorSpec` compares the merged result rather than this app's file on its own. The translation workflow is described in [docs/translations/translations-in-twe.md](./docs/translations/translations-in-twe.md), and `scripts/reorder-yaml.sh` helps keep the two languages in the same order.

## Testing

```bash
make test
sbt "testOnly gov.irs.twe.factDictionary.StandardDeductionSpec"
```

| Package | Covers |
|---|---|
| `factDictionary.*` | Fact logic, one spec per domain (deductions, credits, self-employment, withholding calculations, and so on) |
| `factDictionary.scenarios.UatScenariosSpec` | The UAT spreadsheet suite. Builds a Fact Graph per spreadsheet column from the CSV in `src/test/resources/csv/` and asserts calculated values against it |
| `parser.*` | Flow XML parsing |
| `inputs.YearRangeDateSpec` | The replacement date input's parser |
| `YamlValidatorSpec` | Locale key consistency across the layered result |

`src/main/scala/gov/irs/twe/scenarios/Scenario.scala` builds and queries those graphs, and exports the collection ID constants (`JOB_1_ID` and friends) the specs interpolate into fact paths. When a UAT assertion fails, the value you want is usually upstream of the fact that was checked. [docs/onboarding/ide/intellij/scenario-debugging/](./docs/onboarding/ide/intellij/scenario-debugging/README.md) walks through pausing a scenario in IntelliJ and inspecting facts with Watches.

## Architecture decisions

| ADR | Subject |
|---|---|
| [001](./docs/adr/001-twe-architecture.md) | The TWE 2.0 architecture, and the move off TWE 1.0 |
| [002](./docs/adr/002-security-scanning.md) | Security scanning |
| [003](./docs/adr/003-pdf-generation.md) | Client-side PDF generation |
| [004](./docs/adr/004-internal-debugging-surfaces.md) | Isolating internal debugging surfaces from the product page |

Content conventions are in [docs/design/twe-content-guidelines.md](./docs/design/twe-content-guidelines.md).

## Gotchas

- **A change to Form Builder has to be republished before this app sees it.** In a form-builder checkout, `sbt test publishLocal`, then point `build.sbt` at that version. This applies to parser changes, generator changes, node templates, chrome locales, the theme, and the flow runtime. After such a change, run `make ci` in both applications, because the second one is what catches an app-specific assumption.
- **Flow, facts, and this app's locales are read from disk rather than the classpath.** The library's own templates and base locales do come off the classpath.
- **`make ci-setup` runs `npm install` twice**, once in `src/main/resources/twe/` for the lint tooling and once at this directory's root for the `taxpert` dependency. A clean checkout that skips it fails inside `copy-shared-ui`.
- **`make fact-explorer` is separate from `make dev` on purpose.** The Scala graph generator does not yet emit the `shows` and `exits` edges Fact Explorer's own generator produces, and Fact Explorer prefers an app-served graph wherever it finds one. The target's closing message still prints a `cd ../fact-explorer` path from the old monorepo layout. Fact Explorer now lives at `packages/fact-explorer` in the taxpert repository.
- **A new flow tag needs two registrations.** `FormBuilderApp.nodeTypes` in `Main.scala` makes it render, and `customFlowTags` in `fact-explorer.app.json` makes it reach the graph. Input types need only the first, since `inputType` is a free string on `FlowElement`.
- **HTML comments inside an inline `<script type="module">` are a syntax error**, and they fail silently at runtime. `make validate-templates` exists to catch that.

## Contributing and license

Report security issues through [SECURITY.md](./SECURITY.md).

This codebase is dedicated to the public domain under the Creative Commons Zero v1.0 Universal license (CC0 1.0). Both applications in this repository are covered by the repository's [`LICENSE.md`](../LICENSE.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Authorities

Legal foundations for this work include:

* Source Code Harmonization And Reuse in Information Technology Act of 2024, Public Law 118-187
* OMB Memorandum M-16-21, "Federal Source Code Policy: Achieving Efficiency, Transparency, and Innovation through Reusable and Open Source Software," August 8, 2016
* Federal Acquisition Regulation (FAR) Part 27, Patents, Data, and Copyrights
* Digital Government Strategy: "Digital Government: Building a 21st Century Platform to Better Serve the American People," May 23, 2012
* Federal Information Technology Acquisition Reform Act (FITARA), December 2014 (National Defense Authorization Act for Fiscal Year 2015, Title VIII, Subtitle D)
* E-Government Act of 2002, Public Law 107-347
* Clinger-Cohen Act of 1996, Public Law 104-106
