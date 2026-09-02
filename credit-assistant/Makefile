PORT ?= 3003
DEBUGGER_PORT ?= 5005
RESOURCES_DIR := ./src/main/resources/credit-assistant
OUTPUT_DIR := ./out
HTML_VALIDATE_TARGET := ../../../../out/**/*.html

FLOW_DIR := $(RESOURCES_DIR)/flow
FLOW_CONFIG := $(FLOW_DIR)/FlowConfig.rng

FACTS_DIR := $(RESOURCES_DIR)/facts
FACTS_CONFIG := $(FACTS_DIR)/FactDictionaryModule.rng

FG_SOURCE_DIR := ../../fact-graph/js/target/scala-3.3.6/factgraph-fastopt
FG_TARGET_DIR := ./src/main/resources/credit-assistant/website-static/vendor/fact-graph

SHARED_UI_SRC := node_modules/taxpert/src
# TX-3: the bundled build of the same package — one JS file, three stylesheets, every template
# inlined — for this app, which has no bundler. src/ is still vendored beside it and is still the
# source of truth; see taxpert/packages/ui/scripts/build.mjs.
SHARED_UI_PKG := node_modules/taxpert
SHARED_UI_DIST := node_modules/taxpert/dist

# The app-authored trees `validate-taxpert-seam` scans. Deliberately not the whole of
# website-static/: vendor/ under it is the generated mirror, whose files legitimately
# import one another by path.
TAXPERT_SEAM_DIRS := $(RESOURCES_DIR)/templates $(RESOURCES_DIR)/website-static/js $(RESOURCES_DIR)/website-static/styles
SHARED_UI_TARGET := $(RESOURCES_DIR)/website-static/vendor/taxpert

.PHONY: bootstrap
bootstrap: ## One-time setup: publish the sibling libraries and vendor their assets
	@# fact-graph and form-builder resolve through the local Ivy cache, taxpert through a file: npm
	@# dependency. All three come from checkouts cloned beside this repository rather than from a
	@# registry, so a fresh clone has to build them once before it can build itself.
	$(MAKE) -C ../../fact-graph publish
	cd ../../form-builder && sbt publishLocal
	npm install
	npm --prefix $(RESOURCES_DIR) install
	$(MAKE) copy-fg copy-shared-ui

.PHONY: dev
dev: copy-fg copy-shared-ui ## Build and run development server, watching for changes (Default)
	sbt -Dsmol.port=$(PORT) '~run --serve --auditMode --allScreens --scenarioMode'

.PHONY: dev-ai
dev-ai: copy-fg copy-shared-ui ## Same as `dev`, but also reveals both AI/prompt features (Explain & Analyze chat, AI scenario generation)
	sbt -Dsmol.port=$(PORT) '~run --serve --auditMode --allScreens --scenarioMode --aiScenarioGeneration --aiFactExplanation'

.PHONY: dev-one-question
dev-one-question: copy-fg copy-shared-ui # Run in one question: one screen mode
	sbt -Dsmol.port=$(PORT) '~run --serve --auditMode --allScreens --singleQuestionPerScreen --scenarioMode'

.PHONY: debug
debug: copy-fg copy-shared-ui ## Same as `dev`, but also opens a port to attach a debugger (like your IDE)
	sbt -Dsmol.port=$(PORT) -jvm-debug $(DEBUGGER_PORT) '~run --serve --auditMode --allScreens --scenarioMode'

.PHONY: dev-author
dev-author: copy-fg copy-shared-ui ## Build + dev server with Author Mode editing enabled
	sbt -Dsmol.port=3003 -Dsmol.author.port=3004 '~run --serve --auditMode --allScreens --scenarioMode --authorMode'

help: ## Print the help documentation
	@grep -E '^[/a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: credit-assistant
credit-assistant: copy-fg copy-shared-ui ## Build site for production
	sbt run

.PHONY: site
site: credit-assistant ## Alias for the production build, under the name every Form Builder app uses


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
	# The vendored copy is a generated mirror of taxpert's src/ bundle dirs,
	# each one broken down into js/styles/images/fonts (same shape as vendor/uswds-3.13.0).
	# Wipe first so renamed/removed source files never linger as stale vendored copies.
	#
	# Copies whatever bundles src/ contains rather than naming them. The list used to be
	# spelled out here and in check-shared-ui, and a bundle missing from either silently
	# never reached the browser — the failure taxpert's CLAUDE.md warns about under
	# "a new top-level bundle is different". Deriving it means adding a bundle is a
	# one-directory change again.
	@# Emptied rather than removed, and that is not a style choice. docker-compose.override.yml
	@# bind-mounts taxpert/src over this exact directory, and Docker Desktop stamps a
	@# `user:<you> deny delete` ACL on any host directory it has mounted — so `rm -rf` on the
	@# directory itself fails with "Permission denied" *after* recursively deleting everything
	@# inside it, leaving an empty mirror and a failed build. Clearing the contents does the same
	@# job, keeps the mount point the compose file needs, and works whether or not the stack is up.
	mkdir -p $(SHARED_UI_TARGET)
	find $(SHARED_UI_TARGET) -mindepth 1 -delete
	@# TX-3. The bundle is a build artifact, so it has to be built before it can be vendored. A
	@# `file:` install of taxpert is a symlink to a checkout and carries scripts/, so build it here;
	@# a tarball install ships a prebuilt dist/ and has no scripts/ to run. Neither is a state this
	@# app can fix on its own, so the third case fails loudly rather than vendoring a mirror whose
	@# every page would 404 on one script tag.
	@if [ -f $(SHARED_UI_PKG)/scripts/build.mjs ]; then \
		npm --prefix $(SHARED_UI_PKG) run build; \
	elif [ ! -d $(SHARED_UI_DIST) ]; then \
		echo "==> $(SHARED_UI_DIST) is missing and this install cannot build it — reinstall taxpert"; \
		exit 1; \
	fi
	cp -R $(SHARED_UI_SRC)/. $(SHARED_UI_TARGET)/
	cp -R $(SHARED_UI_DIST) $(SHARED_UI_TARGET)/dist

.PHONY: check-shared-ui
check-shared-ui: ## Verify the vendored shared UI matches taxpert's source
	@# The mirror is generated and gitignored, so a build that skipped copy-shared-ui —
	@# or a hand-edit of the mirror, which the next build silently overwrites — shows up
	@# here as a diff rather than as stale UI in the browser.
	@# Whole-tree diff rather than a per-bundle loop: the loop could only check bundles it
	@# already knew about, so a bundle added to taxpert but not to its list passed here
	@# while being absent from the browser. This also catches a stale bundle left behind.
	@# Two trees now, because the mirror is two things: taxpert's src/, and the bundle built from
	@# it. `-x dist` keeps the first diff from reporting the second as an extra directory.
	@diff -r -x .DS_Store -x dist $(SHARED_UI_SRC) $(SHARED_UI_TARGET) \
		|| { echo "==> vendored shared UI is out of date — run 'make copy-shared-ui'"; exit 1; }
	@diff -r -x .DS_Store $(SHARED_UI_DIST) $(SHARED_UI_TARGET)/dist \
		|| { echo "==> vendored taxpert bundle is out of date — run 'make copy-shared-ui'"; exit 1; }
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
	npm --prefix $(RESOURCES_DIR) run format

.PHONY: clean
clean: ## Clean all the build artifacts
	rm -rf ./target/
	find ./project -name target | xargs rm -rf
	rm -rf $(OUTPUT_DIR)

.PHONY: ci-setup
ci-setup: ## Install validation and linting tools
	npm --prefix $(RESOURCES_DIR) install
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
	make credit-assistant
	make check-shared-ui
	make validate-xml
	make validate-html
	make validate-templates
	make validate-nav-templates
	make validate-taxpert-seam
	make validate-js
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
	npm --prefix $(RESOURCES_DIR) run html-validate -- "$(HTML_VALIDATE_TARGET)"

.PHONY: validate-templates
validate-templates: ## Reject HTML comments inside inline <script> blocks
	@# `<!-- … -->` is a legal, ignored token in a classic script and a *syntax error* in a module
	@# ("HTML comments are not allowed in modules"). One of them in taxpert-config.html killed the
	@# whole configure() call: the nav rendered with no menu, Workspace settings listed no feature
	@# flags, and no tool buttons appeared — with nothing in the build output and only a single
	@# console line to go on. html-validate does not look inside script bodies, so this does.
	@# A line already inside a `//` comment is prose about the hazard, not the hazard.
	@bad=$$(find $(RESOURCES_DIR)/templates -name '*.html' -print0 \
		| xargs -0 awk '/<script/{ins=1} /<\/script>/{ins=0} \
			ins && /<!--/ && $$0 !~ /^[[:space:]]*(\/\/|\*)/ {print FILENAME":"FNR": "$$0}'); \
	if [ -n "$$bad" ]; then \
		echo "==> HTML comment inside a <script> — use // instead:"; echo "$$bad"; exit 1; \
	fi

.PHONY: validate-nav-templates
validate-nav-templates: ## Fail if the inlined nav templates have drifted from taxpert's
	@# fragments/workspace-head.html carries a verbatim copy of the five <template> elements
	@# <taxpert-global-nav> clones its markup from. The copy
	@# is what removes the fetch, and it is the one thing in this repo that duplicates something the
	@# package owns. Nothing about it fails on its own: a template the package renames, or a sixth one
	@# it adds, becomes a bar that throws at render time, in a browser, on a page nobody was looking
	@# at. So diff the two. check-shared-ui already ties $(SHARED_UI_SRC) to the vendored mirror; this
	@# ties the fragment to $(SHARED_UI_SRC).
	@#
	@# Both sides are extracted the same way — every line from `<template id=` to `</template>` at
	@# column 0 — which is why the copy in the fragment is not indented. Temp files rather than
	@# process substitution: CI's /bin/sh is dash, which has none.
	@a=$$(mktemp); b=$$(mktemp); \
	awk '/^<template id=/,/^<\/template>/' $(SHARED_UI_SRC)/global-nav/templates/global-nav.html > $$a; \
	awk '/^<template id=/,/^<\/template>/' $(RESOURCES_DIR)/templates/fragments/workspace-head.html > $$b; \
	if diff -u $$a $$b; then rm -f $$a $$b; else \
		echo "==> workspace-head.html has drifted from taxpert's global-nav.html — re-copy the five <template> blocks"; \
		rm -f $$a $$b; exit 1; \
	fi
	@echo "==> inlined nav templates match taxpert"

.PHONY: validate-taxpert-seam
validate-taxpert-seam: ## Fail if this app imports a taxpert module the bundle already contains
	@# TX-3. The workspace ships as one bundle (vendor/taxpert/dist/js/taxpert.js), and a file in
	@# this app that ALSO names a vendored taxpert module by path gets a second copy of it. For a
	@# module with state in scope — config.js holds the whole workspace configuration — that means
	@# the page configures one instance while the elements read the other. Nothing throws and
	@# nothing is logged; the nav simply comes up with no menu.
	@#
	@# The modules a direct import is legitimate for are the ones the bundle deliberately leaves
	@# external, and taxpert writes that list into dist/seam.json rather than leaving it as a
	@# comment two repositories away. Anything else is the bug above.
	@#
	@# Two filters, not one, and both are needed: these files are heavily commented and several of
	@# the comments name a taxpert module in prose. A load site is a line that also carries an
	@# `import`, `src=` or `href=`, AND has the path immediately behind a quote, a `|` or a `/` —
	@# which is true of every real specifier here and of no sentence written about one.
	@#
	@# Temp files rather than process substitution: CI's /bin/sh is dash, which has none.
	@ok=$$(mktemp); found=$$(mktemp); \
	node -e "for (const m of require('./$(SHARED_UI_DIST)/seam.json').external) console.log(m)" > $$ok; \
	echo "dist/js/taxpert.js" >> $$ok; \
	grep -rhE "(th:)?(src|href)=|import" $(TAXPERT_SEAM_DIRS) 2>/dev/null \
		| grep -ohE "[\"'|/]vendor/taxpert/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*\.js" \
		| sed 's|.*vendor/taxpert/||' | sort -u > $$found; \
	bad=$$(grep -vxF -f $$ok $$found || true); \
	rm -f $$ok $$found; \
	if [ -n "$$bad" ]; then \
		echo "==> these taxpert modules are imported by path AND live inside the bundle:"; \
		echo "$$bad" | sed 's/^/      /'; \
		echo "    import them from vendor/taxpert/dist/js/taxpert.js instead, or add them to"; \
		echo "    SHARED_SEAM in taxpert/packages/ui/scripts/build.mjs if a direct import is wanted."; \
		exit 1; \
	fi
	@echo "==> no taxpert module is loaded both bundled and by path"

.PHONY: validate-js
validate-js: ## Run javascript linter
	npm --prefix $(RESOURCES_DIR) run lint

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
	@echo "    http://localhost:5180/fact-explorer/credit-assistant"
