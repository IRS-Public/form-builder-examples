# Tax Withholding Estimator (TWE)
See [Tax Withholding Estimator](https://github.com/IRS-Public/tax-withholding-estimator) for an overview of TWE.

## Quickstart

```bash
git clone https://github.com/IRS-Public/fact-graph.git
git clone https://github.com/IRS-Public/form-builder.git
git clone https://github.com/IRS-Public/taxpert.git

make bootstrap
make
```
Skip the local build entirely with `make up`, which builds the libraries in Docker, generates the site,
serves it, and leaves an `sbt ~run` watcher regenerating on every edit.


`make` with no target runs `make dev`. The site is served at **http://localhost:3000/app/tax-withholding-estimator**, and the Browse All listing at **http://localhost:3000/app/tax-withholding-estimator/all-screens/**.

All three clones are needed for a build from scratch: `gov.irs::factgraph` isn't published to a registry, so form-builder cannot resolve without a local publish of it. What is optional is refreshing the *browser* bundle. `make copy-fg` prints a message and moves on when it finds no build at `../fact-graph/js/target/`, and the checked-in bundle under `website-static/vendor/fact-graph/` is used instead.

### Docker

[`Dockerfile`](./Dockerfile) builds in three stages: the first publishes fact-graph and form-builder into the image's own Ivy cache, the second generates the site with sbt, and the third serves `./out` with nginx, using [`nginx.conf`](./nginx.conf). The mode flags are included at build time, so changing them means rebuilding the image.

The build context is this directory. The three libraries are separate repositories rather than subdirectories of it, so each arrives as a named additional build context.

```bash
docker build \
  --build-context fact_graph=../fact-graph \
  --build-context form-builder=../form-builder \
  --build-context taxpert=../taxpert/packages/ui \
  -t tax-withholding-estimator .
```

More setup note are in the [Dev Onboarding Docs](./docs/onboarding/onboarding-dev.md). IRS employees should start with the [IRS Onboarding Docs](./docs/onboarding/onboarding-irs.md), and non-developers with the [Non-Dev Onboarding Docs](./docs/onboarding/onboarding-nondev.md). Two IDE guides live under `docs/onboarding/ide/intellij/`: the shared [Live Templates](./docs/onboarding/ide/intellij/live-templates/README.md), and [debugging a UAT scenario](./docs/onboarding/ide/intellij/scenario-debugging/README.md) with IntelliJ Watches.

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
