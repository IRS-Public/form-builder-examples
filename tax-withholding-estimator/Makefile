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

SHARED_UI_SRC := node_modules/@taxpert/ui/src
SHARED_UI_TARGET := $(TWE_RESOURCES_DIR)/website-static/vendor/taxpert-ui

.PHONY: dev
dev: copy-shared-ui ## Build and run development server, watching for changes (Default)
	sbt -Dsmol.port=$(PORT) '~run --serve --auditMode --allScreens'

.PHONY: debug
debug: copy-shared-ui ## Same as `dev`, but also opens a port to attach a debugger (like your IDE)
	sbt -Dsmol.port=$(PORT) -jvm-debug $(DEBUGGER_PORT) '~run --serve --auditMode --allScreens'

help: ## Print the help documentation
	@grep -E '^[/a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: twe
twe: copy-shared-ui ## Build site for production
	sbt run


.PHONY: copy-fg
copy-fg: ## Copy compiled Fact Graph from sibling repository
	cp $(FG_SOURCE_DIR)/main.mjs $(FG_TARGET_DIR)/factgraph-3.1.0.js
	cp $(FG_SOURCE_DIR)/main.mjs.map $(FG_TARGET_DIR)

.PHONY: copy-shared-ui
copy-shared-ui: ## Copy shared UI components (@taxpert/ui) from node_modules
	# The vendored copy is a generated mirror of @taxpert/ui's src/ bundle dirs, each one
	# broken down into js/styles/templates (the same shape as vendor/uswds-3.13.0). TWE has
	# no bundler, so the templates and stylesheets load as plain <script type="module"> and
	# @import from this path.
	# Wipe first so renamed/removed source files never linger as stale vendored copies.
	rm -rf $(SHARED_UI_TARGET)
	mkdir -p $(SHARED_UI_TARGET)
	cp -R $(SHARED_UI_SRC)/global-nav $(SHARED_UI_SRC)/shared $(SHARED_UI_SRC)/audit-panel \
		$(SHARED_UI_SRC)/tool-panels $(SHARED_UI_TARGET)/

.PHONY: check-shared-ui
check-shared-ui: ## Verify the vendored shared UI matches @taxpert/ui's source
	@# The mirror is generated and gitignored, so a build that skipped copy-shared-ui —
	@# or a hand-edit of the mirror, which the next build silently overwrites — shows up
	@# here as a diff rather than as stale UI in the browser.
	@for bundle in global-nav shared audit-panel tool-panels; do \
		diff -r -x .DS_Store $(SHARED_UI_SRC)/$$bundle $(SHARED_UI_TARGET)/$$bundle \
			|| { echo "==> vendored shared UI is out of date — run 'make copy-shared-ui'"; exit 1; }; \
	done
	@echo "==> vendored shared UI matches @taxpert/ui"

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
	@# The shared UI package itself: a file: dependency on the sibling /taxpert-ui checkout,
	@# which is what copy-shared-ui mirrors out of node_modules.
	npm install


.PHONY: ci
ci: ## Run most of the CI checks locally
	make twe
	make check-shared-ui
	make validate-xml
	make validate-html
	make validate-js
	make validate-uswds
	make validate-scala
	# Skip semgrep (locally) for now

.PHONY: validate-xml
validate-xml: ## Validate .xml files
	find $(FACTS_DIR) -name '*.xml' | xargs xmllint --quiet --relaxng $(FACTS_CONFIG) > /dev/null

.PHONY: validate-html
validate-html: ## Validate .html files
	npm --prefix $(TWE_RESOURCES_DIR) run html-validate -- "$(HTML_VALIDATE_TARGET)"

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
