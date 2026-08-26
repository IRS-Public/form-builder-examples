PORT ?= 3000
DEBUGGER_PORT ?= 5005
TWE_RESOURCES_DIR := ./src/main/resources/twe
TWE_OUTPUT_DIR := ./out
HTML_VALIDATE_TARGET := ../../../../out/**/*.html

FLOW_DIR := $(TWE_RESOURCES_DIR)/flow
FLOW_CONFIG := $(FLOW_DIR)/FlowConfig.rng

FACTS_DIR := $(TWE_RESOURCES_DIR)/facts
FACTS_CONFIG := $(FACTS_DIR)/FactDictionaryModule.rng

FG_SOURCE_DIR := ../../fact-graph/js/target/scala-3.3.6/factgraph-fastopt
FG_TARGET_DIR := ./src/main/resources/twe/website-static/vendor/fact-graph

SHARED_UI_SRC := node_modules/taxpert/src
SHARED_UI_TARGET := $(TWE_RESOURCES_DIR)/website-static/vendor/taxpert

.PHONY: bootstrap
bootstrap: ## One-time setup: publish the sibling libraries and vendor their assets
	@# fact-graph and form-builder resolve through the local Ivy cache, taxpert through a file: npm
	@# dependency. All three come from checkouts cloned beside this repository rather than from a
	@# registry, so a fresh clone has to build them once before it can build itself.
	$(MAKE) -C ../../fact-graph publish
	cd ../../form-builder && sbt publishLocal
	npm install
	npm --prefix $(TWE_RESOURCES_DIR) install
	$(MAKE) copy-fg copy-shared-ui

.PHONY: dev
dev: copy-fg copy-shared-ui ## Build and run development server, watching for changes (Default)
	sbt -Dsmol.port=$(PORT) '~run --serve --auditMode --allScreens'

.PHONY: debug
debug: copy-fg copy-shared-ui ## Same as `dev`, but also opens a port to attach a debugger (like your IDE)
	sbt -Dsmol.port=$(PORT) -jvm-debug $(DEBUGGER_PORT) '~run --serve --auditMode --allScreens'

help: ## Print the help documentation
	@grep -E '^[/a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: twe
twe: copy-fg copy-shared-ui ## Build site for production
	sbt run

.PHONY: site
site: twe ## Alias for the production build, under the name every Form Builder app uses


.PHONY: copy-fg
copy-fg: ## Copy compiled Fact Graph from sibling repository
	@# Skipped rather than fatal when the checkout has not been built: this now runs ahead of
	@# every dev server and production build, and not everyone working on templates or
	@# locales has an sbt-built fact-graph beside the repository. The committed bundle serves.
	@if [ -f $(FG_SOURCE_DIR)/main.mjs ]; then \
		cp $(FG_SOURCE_DIR)/main.mjs $(FG_TARGET_DIR)/factgraph-3.1.0.js; \
		cp $(FG_SOURCE_DIR)/main.mjs.map $(FG_TARGET_DIR); \
		echo "==> copied the fact-graph bundle from $(FG_SOURCE_DIR)"; \
	else \
		echo "==> no build at $(FG_SOURCE_DIR); keeping the vendored fact-graph bundle"; \
		echo "    (run 'make bootstrap', or 'make -C ../../fact-graph publish', to refresh it)"; \
	fi

# ── Docker ────────────────────────────────────────────────────────────────────
#
# The same application, without a local JDK, sbt or node: `make up` builds the sibling libraries,
# generates the site and serves it, and the dev overlay leaves a `sbt ~run` watcher regenerating it
# on every edit. Slower to start than `make dev` and the only way in for someone who has not
# installed the toolchain, which is most people the first time they open this repository.
#
# Every application in this repository has this same set of targets over the same pair of compose
# files, so `make up` behaves the same wherever you run it. They wrap docker compose rather than
# replacing it: the compose files are the description, and a target that hid them would be one more
# thing to read before you could use either.

.PHONY: up
up: ## Build (first run) and start the whole stack, with hot reload
	docker compose up --build

.PHONY: down
down: ## Stop and remove the stack
	docker compose down

.PHONY: logs
logs: ## Tail the logs from every service
	docker compose logs -f

.PHONY: ps
ps: ## Show service status
	docker compose ps

.PHONY: rebuild
rebuild: ## Tear down the stack, drop its volumes, and rebuild images from scratch, ignoring the layer cache
	@# The escape hatch for a stale sibling library: form-builder and fact-graph are resolved from
	@# the image's own Ivy cache, not a bind mount, so editing either one needs a rebuild.
	@# down -v first: app-out and sbt-cache persist across a plain `down`/`up`, so a stale sbt
	@# cache or a half-regenerated out/ would otherwise survive a "from scratch" rebuild. Compose
	@# recreates both empty on the next `up`, at which point the watcher repopulates them.
	docker compose down -v
	docker compose build --no-cache

# ── A taxpert checkout somewhere other than ../../taxpert ───────────────────────────────────────────
#
# package.json depends on `taxpert` at `file:../../taxpert/packages/ui` — a checkout of the taxpert
# repository cloned into the root of this repository, beside the two apps. That is what a plain
# `npm install` resolves, and it is the normal path; `make bootstrap` runs it for you.
#
# When your checkout lives somewhere else, install it from there without editing package.json:
#
#   make link-taxpert TAXPERT_UI=/path/to/taxpert/packages/ui
#
# `make copy-shared-ui` and `make check-shared-ui` read node_modules either way, so they work
# unchanged and the committed dependency keeps naming the conventional location.
TAXPERT_UI ?=

.PHONY: link-taxpert
link-taxpert: ## Install the workspace UI from a local taxpert checkout (set TAXPERT_UI=...)
	@test -n "$(TAXPERT_UI)" || { \
	  echo "error: set TAXPERT_UI=/path/to/taxpert/packages/ui"; exit 1; }
	@test -d "$(TAXPERT_UI)/src" || { \
	  echo "error: $(TAXPERT_UI) has no src/ — is that the packages/ui directory?"; exit 1; }
	npm install --no-save "file:$(TAXPERT_UI)"


.PHONY: copy-shared-ui
copy-shared-ui: ## Copy shared UI components (taxpert) from node_modules
	# The vendored copy is a generated mirror of taxpert's src/ bundle dirs, each one
	# broken down into js/styles/templates (the same shape as vendor/uswds-3.13.0). TWE has
	# no bundler, so the templates and stylesheets load as plain <script type="module"> and
	# @import from this path.
	# Wipe first so renamed/removed source files never linger as stale vendored copies.
	# Copies whatever bundles src/ contains rather than naming them, so adding a bundle to
	# taxpert does not need an edit here to reach the browser.
	@# Emptied rather than removed, and that is not a style choice. docker-compose.override.yml
	@# bind-mounts taxpert/src over this exact directory, and Docker Desktop stamps a
	@# `user:<you> deny delete` ACL on any host directory it has mounted — so `rm -rf` on the
	@# directory itself fails with "Permission denied" *after* recursively deleting everything
	@# inside it, leaving an empty mirror and a failed build. Clearing the contents does the same
	@# job, keeps the mount point the compose file needs, and works whether or not the stack is up.
	mkdir -p $(SHARED_UI_TARGET)
	find $(SHARED_UI_TARGET) -mindepth 1 -delete
	cp -R $(SHARED_UI_SRC)/. $(SHARED_UI_TARGET)/

.PHONY: check-shared-ui
check-shared-ui: ## Verify the vendored shared UI matches taxpert's source
	@# The mirror is generated and gitignored, so a build that skipped copy-shared-ui —
	@# or a hand-edit of the mirror, which the next build silently overwrites — shows up
	@# here as a diff rather than as stale UI in the browser.
	@diff -r -x .DS_Store $(SHARED_UI_SRC) $(SHARED_UI_TARGET) \
		|| { echo "==> vendored shared UI is out of date — run 'make copy-shared-ui'"; exit 1; }
	@echo "==> vendored shared UI matches taxpert"

.PHONY: test
test: ## Run test suite
	@# This only prints the tests that fail
	sbt -info 'set Test / testOptions += Tests.Argument(TestFrameworks.ScalaTest, "-oC")' test scalafmtCheckAll

.PHONY: test-watch
test-watch: ## Run and watch tests
	sbt -info 'set Test / testOptions += Tests.Argument(TestFrameworks.ScalaTest, "-oC")' '~test'

.PHONY: format
format: ## Format the Scala and XML code
	@# We only automatically format the fact configs
	find $(FACTS_DIR) -name '*.xml' | xargs -I {} xmllint --format {} --output {}
	sbt scalafmtAll
	npm --prefix $(TWE_RESOURCES_DIR) run format

.PHONY: clean
clean: ## Clean all the build artifacts
	rm -rf ./target/
	find ./project -name target | xargs rm -rf
	rm -rf $(TWE_OUTPUT_DIR)

.PHONY: ci-setup
ci-setup: ## Install validation and linting tools
	npm --prefix $(TWE_RESOURCES_DIR) install
	@# The workspace UI. `taxpert` is a file: dependency on ../../taxpert/packages/ui, so a plain
	@# `npm install` resolves it out of that checkout — no registry and no credentials involved.
	@# TAXPERT_UI redirects it at a checkout kept somewhere else.
	@if [ -n "$(TAXPERT_UI)" ]; then \
		$(MAKE) link-taxpert; \
	else \
		npm install; \
	fi


.PHONY: ci
ci: ## Run most of the CI checks locally
	make twe
	make check-shared-ui
	make validate-xml
	make validate-html
	make validate-templates
	make validate-js
	make validate-uswds
	make validate-scala
	# Skip semgrep (locally) for now

.PHONY: validate-xml
validate-xml: ## Validate .xml files against their RELAX NG schemas
	find $(FACTS_DIR) -name '*.xml' | xargs xmllint --quiet --relaxng $(FACTS_CONFIG) > /dev/null
	@# The flow half of this check was declared (FLOW_DIR/FLOW_CONFIG) and then never run,
	@# so FlowConfig.rng drifted away from the flow it describes without anything noticing.
	find $(FLOW_DIR) -name '*.xml' | xargs xmllint --quiet --relaxng $(FLOW_CONFIG) > /dev/null

.PHONY: validate-html
validate-html: ## Validate .html files
	npm --prefix $(TWE_RESOURCES_DIR) run html-validate -- "$(HTML_VALIDATE_TARGET)"

.PHONY: validate-templates
validate-templates: ## Reject HTML comments inside inline <script> blocks
	@# `<!-- … -->` is a legal, ignored token in a classic script and a *syntax error* in a module
	@# ("HTML comments are not allowed in modules"). One of them in the other app's
	@# taxpert-config.html killed the whole configure() call: the nav rendered with no menu,
	@# Workspace settings listed no feature flags, and no tool buttons appeared — with nothing in
	@# the build output and only a single console line to go on. html-validate does not look inside
	@# script bodies, so this does.
	@# A line already inside a `//` comment is prose about the hazard, not the hazard.
	@bad=$$(find $(TWE_RESOURCES_DIR)/templates -name '*.html' -print0 \
		| xargs -0 awk '/<script/{ins=1} /<\/script>/{ins=0} \
			ins && /<!--/ && $$0 !~ /^[[:space:]]*(\/\/|\*)/ {print FILENAME":"FNR": "$$0}'); \
	if [ -n "$$bad" ]; then \
		echo "==> HTML comment inside a <script> — use // instead:"; echo "$$bad"; exit 1; \
	fi

.PHONY: validate-js
validate-js: ## Run javascript linter
	npm --prefix $(TWE_RESOURCES_DIR) run lint

.PHONY: validate-uswds
validate-uswds: ## Validate vendored USWDS semibold support
	./scripts/check-uswds-semibold.sh

.PHONY: validate-scala
validate-scala: ## Validate Scala code
	sbt scalafmtCheckAll

# Semgrep setup is not handled by ci-setup, but done separately in the GHA files
.PHONY:
semgrep:
	semgrep scan --verbose --metrics off --severity WARNING --error \
		--config p/security-audit --config p/scala

.PHONY: diff-out
diff-out: ## Compare the output static assets on your current branch with `main`
	./scripts/diff-out.sh

.PHONY: fact-explorer
fact-explorer: ## Build with the Form Builder Graph and print this app's Fact Explorer URL
	@# Not folded into `dev`: the Scala generator is not yet at parity with fact-explorer's own
	@# node generator (no shows/exits edges), and Fact Explorer prefers the app-served graph wherever
	@# it finds one — so building with --formBuilderGraph by default would hand it the sparser graph.
	$(MAKE) copy-fg copy-shared-ui
	sbt 'run --formBuilderGraph'
	@echo "==> regenerate Fact Explorer's registry, then open:"
	@echo "    cd ../fact-explorer && npm run build-registry && npm run dev"
	@echo "    http://localhost:5180/fact-explorer/twe"
