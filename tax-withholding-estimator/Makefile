PORT ?= 3000
DEBUGGER_PORT ?= 5005
TWE_RESOURCES_DIR := ./src/main/resources/twe
TWE_OUTPUT_DIR := ./out
HTML_VALIDATE_TARGET := ../../../../out/**/*.html

FLOW_DIR := $(TWE_RESOURCES_DIR)/flow
FLOW_CONFIG := $(FLOW_DIR)/FlowConfig.rng

FACTS_DIR := $(TWE_RESOURCES_DIR)/facts
FACTS_CONFIG := $(FACTS_DIR)/FactDictionaryModule.rng

FG_SOURCE_DIR := ../fact-graph/js/target/scala-3.3.6/factgraph-fastopt
FG_TARGET_DIR := ./src/main/resources/twe/website-static/vendor/fact-graph

SHARED_UI_SRC := node_modules/taxpert/src
SHARED_UI_TARGET := $(TWE_RESOURCES_DIR)/website-static/vendor/taxpert

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
	@# Skipped rather than fatal when the sibling has not been built: this now runs ahead of
	@# every dev server and production build, and not everyone working on templates or
	@# locales has an sbt-built fact-graph sitting next door.
	@if [ -f $(FG_SOURCE_DIR)/main.mjs ]; then \
		cp $(FG_SOURCE_DIR)/main.mjs $(FG_TARGET_DIR)/factgraph-3.1.0.js; \
		cp $(FG_SOURCE_DIR)/main.mjs.map $(FG_TARGET_DIR); \
		echo "==> copied the fact-graph bundle from $(FG_SOURCE_DIR)"; \
	else \
		echo "==> no build at $(FG_SOURCE_DIR); keeping the vendored fact-graph bundle"; \
		echo "    (run 'cd ../fact-graph && sbt fastOptJS' to refresh it)"; \
	fi

# ── Developing against an unpublished taxpert ────────────────────────────────────────────────────
#
# package.json depends on the published `taxpert` package. This repository is deliberately NOT a
# sibling-path dependency any more: these two apps live in their own repository now, and an app in
# its own repository is exactly what an outside adopter has, so it must resolve the workspace UI the
# way they would. Until taxpert is published to npm, point this at a checkout of it:
#
#   make link-taxpert TAXPERT_UI=/path/to/taxpert/packages/ui
#
# That installs it into node_modules without touching package.json, so `make copy-shared-ui` and
# `make check-shared-ui` work unchanged and the committed dependency stays honest.
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
	@# The workspace UI. package.json names the published `taxpert` package, so a plain
	@# `npm install` is what will work once it is on the registry. Until then it 404s, and
	@# `make link-taxpert TAXPERT_UI=/path/to/taxpert/packages/ui` is what puts it in
	@# node_modules — this step then leaves it alone. Without either, the failure would
	@# surface later and less clearly, inside copy-shared-ui.
	@if [ -d node_modules/taxpert ]; then \
		echo "==> node_modules/taxpert is present; leaving it alone"; \
	elif [ -n "$(TAXPERT_UI)" ]; then \
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
