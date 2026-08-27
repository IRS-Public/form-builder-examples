# Earned Income Tax Credit (EITC) Assistant
See [EITC Assistant](https://github.com/IRS-Public/eitc-assistant) for an overview of this application.

## Quickstart

```bash
make bootstrap    # once: publish the libraries, install deps, vendor the assets
make              # http://localhost:3003/app/eitc
```

`make bootstrap` expects the three library checkouts described in the
[repository README](../README.md#quickstart). Full setup instructions for the whole ecosystem, in
Docker or natively, are in the [QUICKSTART.md](https://github.com/IRS-Public/taxpert/blob/main/docs/QUICKSTART.md) in the taxpert repository.

`make` with no target runs `make dev`. That serves the site at **http://localhost:3003/app/eitc** with `--auditMode --allScreens --scenarioMode`, so two extra destinations exist alongside the flow:

| URL | Available under |
|---|---|
| `http://localhost:3003/app/eitc` | Always |
| `http://localhost:3003/app/eitc/all-screens/` | `--allScreens`, which `make dev` passes |
| `http://localhost:3003/app/eitc/author/` | `--authorMode` (`make dev-author`), with its editing API on port 3004 |

All three clones are needed for a build from scratch: `gov.irs::factgraph` isn't published to a registry, so form-builder cannot resolve without a local publish of it. What is optional is refreshing the *browser* bundle. `make copy-fg` prints a message and moves on when it finds no build at `../../fact-graph/js/target/`, and the checked-in bundle under `website-static/vendor/fact-graph/` is used instead.

### Docker

```bash
make up      # http://localhost:3003/app/eitc/
```

`make up` needs no JDK, sbt or node on your machine. It builds both Scala libraries inside the
image, generates the site, serves it through nginx, and leaves an `sbt ~run` watcher regenerating it
as you edit on the host. `make down`, `make logs`, `make ps` and `make rebuild` are the rest of the
set, and every application in this repository has the same ones over the same pair of compose files.

[`Dockerfile`](./Dockerfile) builds in three stages: the first publishes fact-graph and form-builder into the image's own Ivy cache, the second generates the site with sbt, and the third serves `./out` with nginx, using [`nginx.conf`](./nginx.conf). Every application here shares that file, differing only in a four-line `ARG` block at the top. The mode flags come from its `SITE_FLAGS` arg and are baked in at build time, so changing them means rebuilding the image.

The build context is this directory. The three libraries are separate repositories rather than subdirectories of it, so each arrives as a named additional build context. `docker-compose.yml` passes all three, and a plain `docker build` needs them spelled out.

```bash
docker build \
  --build-context fact_graph=../../fact-graph \
  --build-context form-builder=../../form-builder \
  --build-context taxpert=../../taxpert/packages/ui \
  -t credit-assistant .
```

More setup note are in the [Dev Onboarding Docs](./docs/onboarding/onboarding-dev.md). IRS employees should start with the [IRS Onboarding Docs](./docs/onboarding/onboarding-irs.md), and non-developers with the [Non-Dev Onboarding Docs](./docs/onboarding/onboarding-nondev.md). One IDE guide lives under `docs/onboarding/ide/intellij/`: the shared [Live Templates](./docs/onboarding/ide/intellij/live-templates/README.md).

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
| `make copy-fg` | Copy the compiled Fact Graph JS bundle from a `../../fact-graph` checkout |
| `make copy-shared-ui` | Regenerate the vendored `taxpert` mirror from `node_modules/taxpert/src` |
| `make link-taxpert` | Install the workspace UI from a taxpert checkout kept somewhere other than `../../taxpert`. Requires `TAXPERT_UI=/path/to/taxpert/packages/ui` |
| `make clean` | Remove `./target/`, `./project/*/target/`, and `./out/` |
| `make diff-out` | Build `main` in a throwaway worktree and diff the two `out/` trees, via `scripts/diff-out.sh` |

### Docker

Every application in this repository has this same set, over the same pair of compose files.

| Target | Effect |
|---|---|
| `make up` | Build (first run) and start the stack, with hot reload |
| `make down` | Stop and remove the stack |
| `make logs` | Tail the logs from every service |
| `make ps` | Show service status |
| `make rebuild` | Tear down, drop the volumes, and rebuild images ignoring the layer cache. The escape hatch for a stale sibling library |

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