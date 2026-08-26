APPS ?= $(sort $(foreach d,$(wildcard */src/main/resources/*/flow),$(firstword $(subst /, ,$(d)))))

# All three libraries are checkouts beside this repository, so only one copy of each can publish
# `gov.irs::factgraph` / `gov.irs::form-builder` or be vendored as the workspace UI. Each
# application's own Makefile and package.json name the same places one level deeper (`../../`).
FACT_GRAPH_DIR ?= ../fact-graph
FORM_BUILDER_DIR ?= ../form-builder
TAXPERT_UI ?= ../taxpert/packages/ui

# Passed through to each application, so `make ci APPS=credit-assistant SBT_OPTS=-Xmx4g` behaves.
.PHONY: list bootstrap libraries link-taxpert copy-shared-ui check-shared-ui run-all-local run-all-docker down ps logs site ci test format clean

list: ## Print the applications these targets will act on
	@echo "applications:"
	@for app in $(APPS); do echo "    $$app"; done
	@echo "libraries:"
	@echo "    fact-graph    $(FACT_GRAPH_DIR)"
	@echo "    form-builder  $(FORM_BUILDER_DIR)"
	@echo "    taxpert (ui)  $(TAXPERT_UI)"

libraries: ## Publish fact-graph and form-builder into the local Ivy cache, once for every app
	@# Once here rather than once per application. Each app's own `make bootstrap` publishes them
	@# too, which is right when you are working in one app alone and wasteful three times over when
	@# you are not — and, while two form-builder checkouts existed, actively harmful: whichever
	@# published last won, so a stale one could overwrite the artifact the others had just built.
	$(MAKE) -C $(FACT_GRAPH_DIR) publish
	cd $(FORM_BUILDER_DIR) && sbt publishLocal

# Applications differ in which vendored mirrors they own: only benefits-enrollment vendors USWDS
# from npm, and an application generated with include_taxpert_workspace=no has no copy-shared-ui at
# all. Asking make for a target that is not there is a hard error, so the targets below check with
# `make -n` first rather than stopping the whole fan-out at the first application missing one.
bootstrap: libraries ## Full first-run setup for every application
	@# The libraries once, then each application's per-app half: npm install and the vendored
	@# mirrors. Skips the app-level `bootstrap` deliberately, since that would republish the
	@# libraries once per application.
	@for app in $(APPS); do \
		echo "==> $$app: installing"; \
		$(MAKE) -C $$app ci-setup || exit 1; \
		$(MAKE) -C $$app copy-fg || exit 1; \
		for t in copy-shared-ui copy-uswds; do \
			if $(MAKE) -C $$app -n $$t >/dev/null 2>&1; then \
				$(MAKE) -C $$app $$t || exit 1; \
			fi; \
		done; \
	done

link-taxpert: ## Install the workspace UI from one taxpert checkout into every application
	@# The repo-wide form of each application's own link-taxpert. Use it when your taxpert checkout
	@# is not at $(TAXPERT_UI) — a worktree, a branch you are testing every app against. `--no-save`
	@# there means this changes no committed dependency.
	@test -d "$(TAXPERT_UI)/src" || { \
	  echo "error: $(TAXPERT_UI) has no src/ — set TAXPERT_UI=/path/to/taxpert/packages/ui"; exit 1; }
	@for app in $(APPS); do \
		echo "==> $$app: linking $(TAXPERT_UI)"; \
		$(MAKE) -C $$app link-taxpert TAXPERT_UI=$(abspath $(TAXPERT_UI)) || exit 1; \
	done

copy-shared-ui: ## Regenerate every application's vendored taxpert mirror
	@# Run this after updating the taxpert checkout. The mirror is generated and gitignored, and an
	@# app that missed the refresh serves the old workspace with nothing failing to say so.
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n copy-shared-ui >/dev/null 2>&1; then \
			echo "==> $$app"; $(MAKE) -C $$app copy-shared-ui || exit 1; \
		fi; \
	done

check-shared-ui: ## Fail if any application's vendored mirror has drifted
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n check-shared-ui >/dev/null 2>&1; then \
			$(MAKE) -C $$app check-shared-ui || exit 1; \
		fi; \
	done

run-all-local: ## Start every application's dev server at once, until you press Ctrl-C
	@# One `make dev` per application, backgrounded in a single shell. Each application already
	@# fixes its own port (PORT in its Makefile) and its own URL prefix (basePath in its Main.scala),
	@# so the three run side by side with nothing to coordinate here.
	@#
	@# Output is prefixed with the application name, because three sbt logs interleaved with no
	@# labels are unreadable. awk rather than sed, for the `fflush()`: redirect this to a file and a
	@# block-buffering filter holds each application's first few KB back until the next one fills.
	@# BSD and GNU sed spell that flag differently, awk does not.
	@#
	@# stdin is closed for each one: sbt's watch mode reads a keystroke to stop watching, and three
	@# watchers sharing one terminal race for it.
	@#
	@# Ctrl-C stops all of them. They share this shell's process group, so the terminal's SIGINT
	@# reaches every sbt directly rather than through make.
	@for app in $(APPS); do \
		port=$$(sed -n 's/^PORT ?= *//p' $$app/Makefile); \
		path=$$(grep -rh basePath $$app/src/main/scala 2>/dev/null \
			| sed -n 's/.*"\([^"]*\)".*/\1/p' | head -1); \
		echo "==> $$app  http://localhost:$$port$$path/"; \
		( $(MAKE) -C $$app dev < /dev/null 2>&1 \
			| awk -v a="$$app" '{ print "[" a "] " $$0; fflush() }' ) & \
	done; \
	echo "==> sbt takes a minute or so to serve. Ctrl-C stops all of them."; \
	wait

run-all-docker: ## Start every application's Docker stack at once, each on its own port
	@# Every application here has the same Dockerfile shape and the same pair of compose files, so
	@# this is the Docker counterpart of run-all-local: one `docker compose up` per application, each
	@# publishing its own port. Detached rather than attached, because three interleaved build logs
	@# are unreadable and compose keeps its own. `make logs APPS=…` follows one.
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n up >/dev/null 2>&1; then \
			echo "==> $$app"; ( cd $$app && docker compose up --build -d ) || exit 1; \
		fi; \
	done
	@$(MAKE) --no-print-directory ps

down: ## Stop every application's Docker stack
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n down >/dev/null 2>&1; then \
			echo "==> $$app"; ( cd $$app && docker compose down ) || exit 1; \
		fi; \
	done

ps: ## Show every application's Docker service status
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n ps >/dev/null 2>&1; then \
			echo "==> $$app"; ( cd $$app && docker compose ps ); \
		fi; \
	done

logs: ## Tail every application's Docker logs. Narrow with APPS=
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n logs >/dev/null 2>&1; then \
			( cd $$app && docker compose logs -f --tail=20 ) & \
		fi; \
	done; \
	wait

site: ## Production build of every application
	@for app in $(APPS); do echo "==> $$app"; $(MAKE) -C $$app site || exit 1; done

test: ## Run every application's test suite
	@for app in $(APPS); do echo "==> $$app"; $(MAKE) -C $$app test || exit 1; done

format: ## Format every application
	@for app in $(APPS); do echo "==> $$app"; $(MAKE) -C $$app format || exit 1; done

ci: ## Run every application's CI checks
	@# The second application is what catches a library change that quietly assumed the first one's
	@# shape, so this running green matters more than any single app's does.
	@for app in $(APPS); do echo "==> $$app"; $(MAKE) -C $$app ci || exit 1; done

clean: ## Delete every application's build artifacts
	@for app in $(APPS); do $(MAKE) -C $$app clean || exit 1; done

help: ## Print this help
	@grep -E '^[/a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
