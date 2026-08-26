APPS ?= $(sort $(foreach d,$(wildcard */src/main/resources/*/flow),$(firstword $(subst /, ,$(d)))))

# All three libraries are checkouts beside this repository, so only one copy of each can publish
# `gov.irs::factgraph` / `gov.irs::form-builder` or be vendored as the workspace UI. Each
# application's own Makefile and package.json name the same places one level deeper (`../../`).
FACT_GRAPH_DIR ?= ../fact-graph
FORM_BUILDER_DIR ?= ../form-builder
TAXPERT_UI ?= ../taxpert/packages/ui

# The taxpert checkout's repo root, as opposed to $(TAXPERT_UI) one level down — this is what
# run-all-docker/down/ps/logs bring up as a whole stack (Fact Explorer and friends), not just the
# npm package each app's image builds against. A sibling checkout by default, same convention as
# FACT_GRAPH_DIR / FORM_BUILDER_DIR above.
TAXPERT_REPO ?= ../taxpert

# Every service in taxpert's compose files sits behind a profile (see taxpert/Makefile) — a bare
# `docker compose up` there deliberately starts nothing — so this has to be named to start anything
# at all. Mirrors that Makefile's own PROFILES default; override the same way if you only want one.
TAXPERT_PROFILES ?= --profile explorer --profile ai

# Passed through to each application, so `make ci APPS=credit-assistant SBT_OPTS=-Xmx4g` behaves.
.PHONY: list bootstrap libraries link-taxpert copy-shared-ui check-shared-ui run-all-local run-all-docker down ps logs site ci test format clean

list: ## Print the applications these targets will act on
	@echo "applications:"
	@for app in $(APPS); do echo "    $$app"; done
	@echo "libraries:"
	@echo "    fact-graph      $(FACT_GRAPH_DIR)"
	@echo "    form-builder    $(FORM_BUILDER_DIR)"
	@echo "    taxpert (ui)    $(TAXPERT_UI)"
	@echo "    taxpert (stack) $(TAXPERT_REPO)"

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

run-all-docker: ## Start every application's Docker stack at once, each on its own port, plus taxpert's own stack
	@# Every application here has the same Dockerfile shape and the same pair of compose files, so
	@# this is the Docker counterpart of run-all-local: one `docker compose up` per application, each
	@# publishing its own port. Detached rather than attached, because three interleaved build logs
	@# are unreadable and compose keeps its own. `make logs APPS=…` follows one.
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n up >/dev/null 2>&1; then \
			echo "==> $$app"; ( cd $$app && docker compose up --build -d ) || exit 1; \
		fi; \
	done
	@# taxpert is not one of $(APPS) — it has no flow of its own, so the wildcard above never finds
	@# it — and its `up` target runs attached (`docker compose up --build`, no -d), which would block
	@# this loop rather than join it. So the compose invocation is repeated here instead, against
	@# whichever checkout $(TAXPERT_REPO) points at (a sibling by default, same convention as
	@# $(TAXPERT_UI) one level down). This mirrors taxpert/Makefile's own COMPOSE_FILES/PROFILES —
	@# see docker-compose.apps.d/README.md over there for what the fragment files are.
	@#
	@# No per-application registration fragment is written here, unlike form-builder-template's
	@# `make up` (scripts/register-with-taxpert.sh). This repository does not need one: every
	@# application here is a real directory (not a symlink) directly under this repo root, and
	@# taxpert/.env sets TAXPERT_APPS_DIR to this repo's path — so Fact Explorer's own /apps mount
	@# already globs straight to every application's fact-explorer.app.json. Verified by hand: `curl
	@# localhost:5180/data/apps.json` lists all three the moment the container is up, no fragment
	@# needed. That env var is specific to this machine's taxpert checkout, though — if a fresh
	@# taxpert clone has no such override, point it at this repo (see taxpert/apps/README.md) or add
	@# a docker-compose.apps.d fragment per README there.
	@if [ -f "$(TAXPERT_REPO)/docker-compose.yml" ]; then \
		echo "==> taxpert ($(TAXPERT_REPO))"; \
		( cd $(TAXPERT_REPO) && \
		  compose_args="-f docker-compose.yml -f docker-compose.override.yml"; \
		  for f in docker-compose.apps.d/*.yml; do [ -f "$$f" ] && compose_args="$$compose_args -f $$f"; done; \
		  docker compose $$compose_args $(TAXPERT_PROFILES) up --build -d ) || exit 1; \
	else \
		echo "==> no taxpert checkout at $(TAXPERT_REPO) — skipping (set TAXPERT_REPO=/path/to/taxpert)"; \
	fi
	@$(MAKE) --no-print-directory ps

down: ## Stop every application's Docker stack, and taxpert's
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n down >/dev/null 2>&1; then \
			echo "==> $$app"; ( cd $$app && docker compose down ) || exit 1; \
		fi; \
	done
	@if [ -f "$(TAXPERT_REPO)/docker-compose.yml" ]; then \
		echo "==> taxpert ($(TAXPERT_REPO))"; $(MAKE) -C $(TAXPERT_REPO) --no-print-directory down || exit 1; \
	fi

ps: ## Show every application's Docker service status, and taxpert's
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n ps >/dev/null 2>&1; then \
			echo "==> $$app"; ( cd $$app && docker compose ps ); \
		fi; \
	done
	@if [ -f "$(TAXPERT_REPO)/docker-compose.yml" ]; then \
		echo "==> taxpert ($(TAXPERT_REPO))"; $(MAKE) -C $(TAXPERT_REPO) --no-print-directory ps; \
	fi

logs: ## Tail every application's Docker logs, and taxpert's. Narrow with APPS=
	@for app in $(APPS); do \
		if $(MAKE) -C $$app -n logs >/dev/null 2>&1; then \
			( cd $$app && docker compose logs -f --tail=20 ) & \
		fi; \
	done; \
	if [ -f "$(TAXPERT_REPO)/docker-compose.yml" ]; then \
		$(MAKE) -C $(TAXPERT_REPO) --no-print-directory logs & \
	fi; \
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
